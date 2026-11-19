import { describe, expect, it, vi } from "vitest";
import { ActionService } from "../../src/application/action-service.js";
import {
  buildCleanupCandidates,
  previewCleanupQueue,
} from "../../src/application/cleanup-service.js";
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

const dupUnusedSkill: SkillRecord = {
  id: "acme/dup-skill",
  primitive: "skill",
  name: "dup-skill",
  description: "Duplicate unused",
  provenance: {
    author: "acme",
    owningManager: "npx-skills",
    managedId: "dup-skill",
    updateStatus: { updateAvailable: false },
  },
  tokens: { descriptionTokens: 50, frontmatterTokens: 60, bodyTokens: 140, fullTokens: 200 },
  exposures: [
    {
      harnessId: "claude",
      scope: "global",
      path: "/home/user/.claude/skills/dup-skill",
      skillFilePath: "/home/user/.claude/skills/dup-skill/SKILL.md",
      linkType: "symlink-healthy",
    },
  ],
  projectPaths: ["/proj/a"],
  projectCount: 1,
  hasDrift: false,
  duplicates: {
    reasons: ["multiple-physical-copies"],
    siblingIds: [],
    siblingNames: [],
    physicalCopies: 2,
  },
  hasBrokenLinks: false,
  metadata: { name: "dup-skill", description: "Duplicate unused", rawFrontmatter: {} },
};

const activeSkill: SkillRecord = {
  ...dupUnusedSkill,
  id: "acme/active",
  name: "active",
  tokens: { descriptionTokens: 150, frontmatterTokens: 180, bodyTokens: 620, fullTokens: 800 },
  projectPaths: [],
  projectCount: 0,
  usage: { activationCount: 3, lastUsedAt: "2026-11-18T00:00:00Z", lastHarness: "claude" },
};
delete (activeSkill as { duplicates?: unknown }).duplicates;

describe("CleanupService", () => {
  it("builds candidates across categories and computes expected token savings", () => {
    const candidates = buildCleanupCandidates([dupUnusedSkill, activeSkill]);
    expect(candidates.map((c) => c.category)).toEqual(["duplicates", "unused"]);

    const actionService = new ActionService(makeExecutor());
    const preview = previewCleanupQueue(
      actionService,
      [dupUnusedSkill, activeSkill],
      [
        {
          skillId: "acme/dup-skill",
          category: "duplicates",
          action: "remove",
          targetScope: "project",
        },
      ],
    );

    expect(preview.impact.removeCount).toBe(1);
    expect(preview.impact.byCategorySelected.duplicates).toBe(1);
    expect(preview.impact.tokensSavedDesc).toBe(50);
    expect(preview.impact.tokensSavedDescPct).toBe(25);
    expect(preview.impact.tokensSavedFull).toBe(200);
    expect(preview.impact.tokensSavedFullPct).toBe(20);
    expect(preview.commands).toHaveLength(1);
    expect(preview.commands[0]?.cwd).toBe("/proj/a");
  });
});
