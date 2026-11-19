import { describe, expect, it } from "vitest";
import type { SourceCatalogPort } from "../../src/application/ports.js";
import { SourceCatalogService } from "../../src/application/source-catalog-service.js";
import type { SkillRecord } from "../../src/domain/index.js";

function makeInstalledSkill(name: string, author: string, sourceRepo: string): SkillRecord {
  return {
    id: `${author}/${name}`,
    primitive: "skill",
    name,
    description: `${name} desc`,
    provenance: {
      author,
      sourceRepo,
      owningManager: "npx-skills",
      updateStatus: { updateAvailable: false },
    },
    tokens: { descriptionTokens: 10, frontmatterTokens: 12, bodyTokens: 30, fullTokens: 42 },
    exposures: [],
    projectPaths: [],
    projectCount: 0,
    hasDrift: false,
    hasBrokenLinks: false,
    metadata: { name, description: `${name} desc`, rawFrontmatter: {} },
  };
}

describe("SourceCatalogService", () => {
  it("groups installed, available, and deprecated skills by source", async () => {
    const port: SourceCatalogPort = {
      discoverCatalogs: async () => [
        {
          sourceId: "https://github.com/acme/skills",
          author: "acme",
          sourceRepo: "https://github.com/acme/skills",
          owningManager: "npx-skills",
          catalogComplete: true,
          skills: [
            { name: "alpha", pathInSource: "skills/alpha/SKILL.md" },
            { name: "beta", pathInSource: "skills/beta/SKILL.md", description: "Newer skill" },
            {
              name: "gamma",
              pathInSource: "skills/gamma/SKILL.md",
              deprecated: true,
              replacedBy: "beta",
            },
          ],
        },
      ],
    };

    const installed = [
      makeInstalledSkill("alpha", "acme", "https://github.com/acme/skills"),
      makeInstalledSkill("legacy", "acme", "https://github.com/acme/skills"),
    ];

    const service = new SourceCatalogService(port);
    const groups = await service.buildCatalog(installed, false);

    expect(groups).toHaveLength(1);
    const acme = groups[0]!;
    expect(acme.installedCount).toBe(1); // alpha
    expect(acme.availableCount).toBe(1); // beta
    expect(acme.deprecatedCount).toBe(2); // legacy (removed in latest) + gamma (marked deprecated)

    expect(acme.skills.find((s) => s.name === "alpha")?.lifecycle).toBe("installed");
    expect(acme.skills.find((s) => s.name === "beta")?.lifecycle).toBe("available");
    expect(acme.skills.find((s) => s.name === "legacy")?.lifecycle).toBe("deprecated");
    expect(acme.skills.find((s) => s.name === "gamma")?.replacedBy).toBe("beta");
  });
});
