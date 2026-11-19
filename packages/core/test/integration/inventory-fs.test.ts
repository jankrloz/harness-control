import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InventoryService } from "../../src/application/inventory-service.js";
import type { GitInspectorPort, NativeCliPort } from "../../src/application/ports.js";
import type { HarnessDefinition } from "../../src/domain/index.js";
import { FsSkillScanner } from "../../src/infrastructure/fs-scanner.js";
import { TiktokenCounter } from "../../src/infrastructure/tiktoken-counter.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hm-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const noopCli: NativeCliPort = {
  discoverAll: async () => ({ entries: [], warnings: [] }),
};

const noopGit: GitInspectorPort = {
  inspectPath: async () => null,
};

describe("InventoryService integration with FsSkillScanner & TiktokenCounter", () => {
  it("discovers global skills, broken symlinks, and project drift", async () => {
    const root = await makeTempDir();
    const globalDir = path.join(root, "global-claude-skills");
    const storeDir = path.join(root, "store", "my-skill");
    const workspaceRoot = path.join(root, "workspace");
    const projectA = path.join(workspaceRoot, "proj-a");

    await fs.mkdir(globalDir, { recursive: true });
    await fs.mkdir(storeDir, { recursive: true });
    await fs.mkdir(path.join(projectA, ".claude", "skills", "my-skill"), { recursive: true });

    await fs.writeFile(
      path.join(storeDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: Global skill description\nmetadata:\n  author: acme\n---\n# Body\nGlobal body.\n`,
    );
    await fs.symlink(storeDir, path.join(globalDir, "my-skill"));
    await fs.symlink(path.join(root, "missing-target"), path.join(globalDir, "dangling-skill"));

    await fs.writeFile(
      path.join(projectA, ".claude", "skills", "my-skill", "SKILL.md"),
      `---\nname: my-skill\ndescription: Modified project copy\nmetadata:\n  author: acme\n---\n# Body\nDrifted.\n`,
    );

    const harnesses: HarnessDefinition[] = [
      {
        id: "claude",
        displayName: "Claude Code",
        supportLevel: "full",
        globalSkillDirs: [globalDir],
        projectSkillDirs: [".claude/skills"],
        supportedPrimitives: ["skill"],
      },
    ];

    const service = new InventoryService(
      new FsSkillScanner(),
      noopCli,
      new TiktokenCounter(),
      noopGit,
    );

    const snapshot = await service.scan(harnesses, {
      workspaceRoots: [workspaceRoot],
      customHarnesses: [],
      maxScanDepth: 3,
      checkRemoteUpdates: false,
    });

    const mySkill = snapshot.skills.find((s) => s.name === "my-skill");
    expect(mySkill).toBeDefined();
    expect(mySkill?.provenance.author).toBe("acme");
    expect(mySkill?.projectCount).toBe(1);
    expect(mySkill?.hasDrift).toBe(true);
    expect(mySkill?.driftDetails?.reasons).toContain("global-project-overlap");
    expect(mySkill?.driftDetails?.reasons).toContain("content-divergence");
    expect(mySkill?.driftDetails?.reasons).toContain("multiple-copies");
    expect(mySkill?.driftDetails?.hasGlobalAndProject).toBe(true);
    expect(
      mySkill?.driftDetails?.copies.some((c) => c.scope === "project" && c.relativeToGlobal),
    ).toBe(true);
    expect(mySkill?.driftDetails?.physicalCopies).toBe(2);
    expect(mySkill?.duplicates?.reasons).toContain("multiple-physical-copies");
    expect(mySkill?.tokens.descriptionTokens).toBeGreaterThan(0);
    expect(mySkill?.tokens.fullTokens).toBeGreaterThan(mySkill!.tokens.descriptionTokens);

    const broken = snapshot.skills.find((s) => s.name === "dangling-skill");
    expect(broken).toBeDefined();
    expect(broken?.hasBrokenLinks).toBe(true);
  });

  it("detects duplicate skills sharing identical content hash across names", async () => {
    const root = await makeTempDir();
    const globalDir = path.join(root, "global-skills");
    const skillA = path.join(globalDir, "skill-alpha");
    const skillB = path.join(globalDir, "skill-beta");

    await fs.mkdir(skillA, { recursive: true });
    await fs.mkdir(skillB, { recursive: true });
    const sharedContent = `---\ndescription: Identical\n---\n# Same Body\n`;
    await fs.writeFile(path.join(skillA, "SKILL.md"), sharedContent);
    await fs.writeFile(path.join(skillB, "SKILL.md"), sharedContent);

    const harnesses: HarnessDefinition[] = [
      {
        id: "claude",
        displayName: "Claude Code",
        supportLevel: "full",
        globalSkillDirs: [globalDir],
        projectSkillDirs: [],
        supportedPrimitives: ["skill"],
      },
    ];

    const service = new InventoryService(
      new FsSkillScanner(),
      noopCli,
      new TiktokenCounter(),
      noopGit,
    );

    const snapshot = await service.scan(harnesses, {
      workspaceRoots: [],
      customHarnesses: [],
      maxScanDepth: 2,
      checkRemoteUpdates: false,
    });

    const alpha = snapshot.skills.find((s) => s.exposures[0]?.path === skillA);
    expect(alpha?.duplicates?.reasons).toContain("same-content-hash");
    expect(alpha?.duplicates?.siblingNames).toHaveLength(1);
    expect(alpha?.hasDrift).toBe(true);
    expect(alpha?.driftDetails?.reasons).toContain("duplicate-source");
  });
});
