import { describe, expect, it } from "vitest";
import { computeGlobalTelemetry } from "../../src/application/telemetry.js";
import type { SkillRecord } from "../../src/domain/index.js";

function makeSkill(
  id: string,
  author: string,
  harnessIds: string[],
  descTokens: number,
  fullTokens: number,
  projectRoot?: string,
): SkillRecord {
  return {
    id,
    primitive: "skill",
    name: id,
    description: "desc",
    provenance: {
      author,
      owningManager: "manual",
      updateStatus: { updateAvailable: false },
    },
    tokens: {
      descriptionTokens: descTokens,
      frontmatterTokens: descTokens + 5,
      bodyTokens: fullTokens - descTokens - 5,
      fullTokens,
    },
    exposures: harnessIds.map((h) => ({
      harnessId: h,
      scope: projectRoot ? "project" : "global",
      path: `/tmp/${h}/${id}`,
      skillFilePath: `/tmp/${h}/${id}/SKILL.md`,
      linkType: "physical-copy",
      ...(projectRoot ? { projectRoot } : {}),
    })),
    projectPaths: projectRoot ? [projectRoot] : [],
    projectCount: projectRoot ? 1 : 0,
    hasDrift: false,
    hasBrokenLinks: false,
    metadata: { name: id, description: "desc", rawFrontmatter: {} },
  };
}

describe("computeGlobalTelemetry", () => {
  it("aggregates global, per-harness, per-author, and per-project token counts sorted descending", () => {
    const skills = [
      makeSkill("alpha", "alice", ["claude", "codex"], 20, 200),
      makeSkill("beta", "bob", ["claude"], 50, 500),
      makeSkill("gamma", "bob", ["gemini"], 30, 300),
      makeSkill("proj-skill", "bob", ["claude"], 40, 900, "/work/heavy-app"),
    ];

    const telemetry = computeGlobalTelemetry(skills);

    expect(telemetry.totalUniqueSkills).toBe(4);
    expect(telemetry.totalTokens.descriptionTokens).toBe(100);
    expect(telemetry.totalTokens.fullTokens).toBe(1000);
    expect(telemetry.projectTokens.fullTokens).toBe(900);

    expect(telemetry.byHarness[0]?.harnessId).toBe("claude");
    expect(telemetry.byHarness[0]?.tokens.descriptionTokens).toBe(70);
    expect(telemetry.byHarness[0]?.skillCount).toBe(2);

    expect(telemetry.byAuthor[0]?.author).toBe("bob");
    expect(telemetry.byAuthor[0]?.tokens.fullTokens).toBe(1700);
    expect(telemetry.byAuthor[0]?.skillCount).toBe(3);

    expect(telemetry.byProject[0]?.projectRoot).toBe("/work/heavy-app");
    expect(telemetry.byProject[0]?.tokens.fullTokens).toBe(900);
  });
});
