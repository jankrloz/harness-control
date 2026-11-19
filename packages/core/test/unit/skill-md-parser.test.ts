import { describe, expect, it } from "vitest";
import { parseSkillMd } from "../../src/infrastructure/skill-md-parser.js";

describe("parseSkillMd", () => {
  it("extracts frontmatter metadata and splits body", () => {
    const raw = `---
name: git-commit
description: Generate clean conventional commits
license: MIT
metadata:
  author: acme
  version: "1.2.3"
---
# Git Commit

Always use conventional commits.
`;
    const parsed = parseSkillMd(raw, "fallback");
    expect(parsed.metadata.name).toBe("git-commit");
    expect(parsed.metadata.description).toBe("Generate clean conventional commits");
    expect(parsed.metadata.author).toBe("acme");
    expect(parsed.metadata.version).toBe("1.2.3");
    expect(parsed.frontmatterRaw).toContain("name: git-commit");
    expect(parsed.bodyRaw).toContain("# Git Commit");
  });

  it("falls back to directory name when frontmatter is absent", () => {
    const parsed = parseSkillMd("# Plain Markdown", "my-skill");
    expect(parsed.metadata.name).toBe("my-skill");
    expect(parsed.metadata.description).toBe("");
    expect(parsed.bodyRaw).toBe("# Plain Markdown");
  });
});
