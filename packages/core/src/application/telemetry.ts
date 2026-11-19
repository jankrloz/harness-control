import type {
  AuthorTokenSummary,
  GlobalTokenTelemetry,
  HarnessId,
  HarnessTokenSummary,
  ProjectTokenSummary,
  SkillRecord,
  TokenFootprint,
} from "../domain/index.js";

const EMPTY_FOOTPRINT: TokenFootprint = {
  descriptionTokens: 0,
  frontmatterTokens: 0,
  bodyTokens: 0,
  fullTokens: 0,
};

function addFootprints(a: TokenFootprint, b: TokenFootprint): TokenFootprint {
  return {
    descriptionTokens: a.descriptionTokens + b.descriptionTokens,
    frontmatterTokens: a.frontmatterTokens + b.frontmatterTokens,
    bodyTokens: a.bodyTokens + b.bodyTokens,
    fullTokens: a.fullTokens + b.fullTokens,
  };
}

export function computeGlobalTelemetry(skills: readonly SkillRecord[]): GlobalTokenTelemetry {
  let totalTokens = EMPTY_FOOTPRINT;
  let projectTokens = EMPTY_FOOTPRINT;
  const harnessMap = new Map<HarnessId, { skillIds: Set<string>; tokens: TokenFootprint }>();
  const authorMap = new Map<
    string,
    { sourceRepo?: string; skillCount: number; tokens: TokenFootprint }
  >();
  const projectMap = new Map<
    string,
    { skillIds: Set<string>; harnesses: Set<HarnessId>; tokens: TokenFootprint }
  >();

  for (const skill of skills) {
    const hasGlobalExposure = skill.exposures.some((e) => e.scope === "global");
    if (hasGlobalExposure) {
      totalTokens = addFootprints(totalTokens, skill.tokens);
    }

    const seenHarnessesForSkill = new Set<HarnessId>();
    const seenProjectsForSkill = new Set<string>();
    for (const exposure of skill.exposures) {
      if (exposure.scope === "project" && exposure.projectRoot) {
        const proj = projectMap.get(exposure.projectRoot) ?? {
          skillIds: new Set<string>(),
          harnesses: new Set<HarnessId>(),
          tokens: EMPTY_FOOTPRINT,
        };
        proj.harnesses.add(exposure.harnessId);
        if (!proj.skillIds.has(skill.id)) {
          proj.skillIds.add(skill.id);
          proj.tokens = addFootprints(proj.tokens, skill.tokens);
        }
        projectMap.set(exposure.projectRoot, proj);

        if (!seenProjectsForSkill.has(skill.id)) {
          seenProjectsForSkill.add(skill.id);
          projectTokens = addFootprints(projectTokens, skill.tokens);
        }
        continue;
      }

      if (exposure.scope !== "global") {
        continue;
      }
      if (seenHarnessesForSkill.has(exposure.harnessId)) {
        continue;
      }
      seenHarnessesForSkill.add(exposure.harnessId);

      const current = harnessMap.get(exposure.harnessId) ?? {
        skillIds: new Set<string>(),
        tokens: EMPTY_FOOTPRINT,
      };
      current.skillIds.add(skill.id);
      current.tokens = addFootprints(current.tokens, skill.tokens);
      harnessMap.set(exposure.harnessId, current);
    }

    const authorKey = skill.provenance.author || "unknown";
    const existingAuthor = authorMap.get(authorKey) ?? {
      ...(skill.provenance.sourceRepo ? { sourceRepo: skill.provenance.sourceRepo } : {}),
      skillCount: 0,
      tokens: EMPTY_FOOTPRINT,
    };
    existingAuthor.skillCount += 1;
    existingAuthor.tokens = addFootprints(existingAuthor.tokens, skill.tokens);
    if (!existingAuthor.sourceRepo && skill.provenance.sourceRepo) {
      existingAuthor.sourceRepo = skill.provenance.sourceRepo;
    }
    authorMap.set(authorKey, existingAuthor);
  }

  const byHarness: HarnessTokenSummary[] = Array.from(harnessMap.entries())
    .map(([harnessId, data]) => ({
      harnessId,
      skillCount: data.skillIds.size,
      tokens: data.tokens,
    }))
    .sort((a, b) => b.tokens.descriptionTokens - a.tokens.descriptionTokens);

  const byAuthor: AuthorTokenSummary[] = Array.from(authorMap.entries())
    .map(([author, data]) => ({
      author,
      ...(data.sourceRepo ? { sourceRepo: data.sourceRepo } : {}),
      skillCount: data.skillCount,
      tokens: data.tokens,
    }))
    .sort((a, b) => b.tokens.fullTokens - a.tokens.fullTokens);

  const byProject: ProjectTokenSummary[] = Array.from(projectMap.entries())
    .map(([projectRoot, data]) => ({
      projectRoot,
      skillCount: data.skillIds.size,
      harnesses: Array.from(data.harnesses),
      tokens: data.tokens,
    }))
    .sort((a, b) => b.tokens.fullTokens - a.tokens.fullTokens);

  return {
    totalUniqueSkills: skills.length,
    totalTokens,
    projectTokens,
    byHarness,
    byAuthor,
    byProject,
  };
}
