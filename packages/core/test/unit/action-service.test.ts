import { describe, expect, it, vi } from "vitest";
import { ActionService } from "../../src/application/action-service.js";
import type { CommandExecutorPort } from "../../src/application/ports.js";
import type { SkillRecord } from "../../src/domain/index.js";

function makeExecutor(): CommandExecutorPort {
  return {
    executeCommand: vi.fn(async (cmd) => ({
      command: cmd.command,
      args: cmd.args,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    })),
    applyPathChange: vi.fn(async () => undefined),
  };
}

const apmSkill: SkillRecord = {
  id: "acme/apm-skill",
  primitive: "skill",
  name: "apm-skill",
  description: "APM managed",
  provenance: {
    author: "acme",
    owningManager: "apm",
    managedId: "acme/apm-skill",
    updateStatus: { updateAvailable: true },
  },
  tokens: { descriptionTokens: 10, frontmatterTokens: 15, bodyTokens: 85, fullTokens: 100 },
  exposures: [
    {
      harnessId: "claude",
      scope: "global",
      path: "/home/user/.claude/skills/apm-skill",
      skillFilePath: "/home/user/.claude/skills/apm-skill/SKILL.md",
      linkType: "symlink-healthy",
    },
  ],
  projectPaths: [],
  projectCount: 0,
  hasDrift: false,
  hasBrokenLinks: false,
  metadata: { name: "apm-skill", description: "APM managed", rawFrontmatter: {} },
};

const manualSkill: SkillRecord = {
  ...apmSkill,
  id: "manual-skill",
  name: "manual-skill",
  provenance: {
    author: "local",
    owningManager: "manual",
    updateStatus: { updateAvailable: false },
  },
};

describe("ActionService", () => {
  it("delegates remove to owning manager CLI in preview and execution", async () => {
    const executor = makeExecutor();
    const service = new ActionService(executor);

    const preview = service.previewRemove([apmSkill], { skillId: "acme/apm-skill" });
    expect(preview.commands).toHaveLength(1);
    expect(preview.commands[0]?.command).toBe("apm");
    expect(preview.commands[0]?.args).toEqual(["uninstall", "acme/apm-skill", "-g"]);

    const result = await service.executeRemove([apmSkill], { skillId: "acme/apm-skill" });
    expect(result.success).toBe(true);
    expect(executor.executeCommand).toHaveBeenCalledTimes(1);
  });

  it("blocks unmanaged remove because direct file deletion (rm) is disabled", async () => {
    const executor = makeExecutor();
    const service = new ActionService(executor);

    const blocked = await service.executeRemove([manualSkill], { skillId: "manual-skill" });
    expect(blocked.success).toBe(false);
    expect(blocked.preview.pathChanges).toHaveLength(0);
    expect(executor.applyPathChange).not.toHaveBeenCalled();

    const evenWithFlag = await service.executeRemove([manualSkill], {
      skillId: "manual-skill",
      confirmUnmanaged: true,
    });
    expect(evenWithFlag.success).toBe(false);
    expect(executor.applyPathChange).not.toHaveBeenCalled();
  });

  it("skips git-clone upgrade instead of running direct git pull", () => {
    const executor = makeExecutor();
    const service = new ActionService(executor);
    const gitSkill: SkillRecord = {
      ...manualSkill,
      id: "git-skill",
      name: "git-skill",
      provenance: {
        author: "acme",
        owningManager: "git-clone",
        updateStatus: { updateAvailable: true },
      },
    };

    const preview = service.previewUpgrade([gitSkill], { scope: "skill", skillId: "git-skill" });
    expect(preview.commands).toHaveLength(0);
    expect(preview.warnings[0]).toContain("direct git pull is disabled");
  });

  it("builds migrate-to-apm preview with global + project install and legacy removal", () => {
    const executor = makeExecutor();
    const service = new ActionService(executor);

    const npxSkill: SkillRecord = {
      ...apmSkill,
      id: "acme/npx-one",
      name: "npx-one",
      exposures: [
        ...apmSkill.exposures,
        {
          harnessId: "claude",
          scope: "project",
          path: "/proj/a/.claude/skills/npx-one",
          skillFilePath: "/proj/a/.claude/skills/npx-one/SKILL.md",
          linkType: "symlink-healthy",
        },
      ],
      projectPaths: ["/proj/a"],
      projectCount: 1,
      provenance: {
        author: "acme",
        sourceRepo: "https://github.com/acme/npx-one",
        owningManager: "npx-skills",
        managedId: "npx-one",
        updateStatus: { updateAvailable: false },
      },
    };

    const preview = service.previewMigrateToApm([npxSkill], {
      skillIds: ["acme/npx-one"],
      cleanupLegacyLockfiles: true,
    });

    expect(
      preview.commands.map((c) => `${c.command} ${c.args.join(" ")}${c.cwd ? ` @${c.cwd}` : ""}`),
    ).toEqual([
      "apm install https://github.com/acme/npx-one -g",
      "apm install https://github.com/acme/npx-one @/proj/a",
      "npx skills remove npx-one -g -y",
      "npx skills remove npx-one -y @/proj/a",
    ]);
  });

  it("previews primitive actions (migrate MCP to APM and remove)", () => {
    const executor = makeExecutor();
    const service = new ActionService(executor);

    const migratePreview = service.previewPrimitiveAction({
      action: "migrate-to-apm",
      kind: "mcp",
      name: "context7",
      harnessId: "claude",
      owningManager: "manual",
      scope: "global",
    });

    expect(migratePreview.commands.map((c) => `${c.command} ${c.args.join(" ")}`)).toEqual([
      "apm mcp install context7 -g",
      "claude mcp remove context7",
    ]);

    const removeManual = service.previewPrimitiveAction({
      action: "remove",
      kind: "hook",
      name: "PreToolUse",
      harnessId: "claude",
      owningManager: "manual",
      path: "/Users/me/.claude/settings.json",
    });
    expect(removeManual.commands).toHaveLength(0);
    expect(removeManual.warnings[0]).toContain("Direct file deletion (rm) is disabled");
  });

  it("removes all skills by source via manager commands", () => {
    const executor = makeExecutor();
    const service = new ActionService(executor);
    const npxSkill: SkillRecord = {
      ...apmSkill,
      id: "acme/npx-two",
      name: "npx-two",
      provenance: {
        author: "acme",
        owningManager: "npx-skills",
        managedId: "npx-two",
        updateStatus: { updateAvailable: false },
      },
    };

    const preview = service.previewRemove([apmSkill, npxSkill, manualSkill], {
      scope: "author",
      author: "acme",
    });

    expect(preview.targetSkillIds).toEqual(["acme/apm-skill", "acme/npx-two"]);
    expect(preview.commands.map((c) => `${c.command} ${c.args.join(" ")}`)).toEqual([
      "apm uninstall acme/apm-skill -g",
      "npx skills remove npx-two -g -y",
    ]);
  });

  it("supports targetScope (global, project, selected-projects, all) when removing", () => {
    const executor = makeExecutor();
    const service = new ActionService(executor);
    const hybridSkill: SkillRecord = {
      ...apmSkill,
      id: "acme/hybrid",
      name: "hybrid",
      provenance: {
        author: "acme",
        owningManager: "npx-skills",
        managedId: "hybrid",
        updateStatus: { updateAvailable: false },
      },
      projectPaths: ["/proj/a", "/proj/b"],
      projectCount: 2,
    };

    const globalOnly = service.previewRemove([hybridSkill], {
      skillId: "acme/hybrid",
      targetScope: "global",
    });
    expect(
      globalOnly.commands.map((c) => `${c.command} ${c.args.join(" ")}@${c.cwd ?? "global"}`),
    ).toEqual(["npx skills remove hybrid -g -y@global"]);

    const selectedProj = service.previewRemove([hybridSkill], {
      skillId: "acme/hybrid",
      targetScope: "selected-projects",
      projectPaths: ["/proj/b"],
    });
    expect(
      selectedProj.commands.map((c) => `${c.command} ${c.args.join(" ")}@${c.cwd ?? "global"}`),
    ).toEqual(["npx skills remove hybrid -y@/proj/b"]);

    const both = service.previewRemove([hybridSkill], {
      skillId: "acme/hybrid",
      targetScope: "all",
    });
    expect(both.commands).toHaveLength(3);
  });
});
