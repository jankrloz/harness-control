import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  SourceCatalogPort,
  UpstreamSourceCatalog,
  UpstreamSourceSkill,
} from "../application/index.js";
import type { SkillRecord } from "../domain/index.js";
import { parseSkillMd } from "./skill-md-parser.js";

const execFileAsync = promisify(execFile);

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findGitRoot(startDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startDir,
      timeout: 3000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function scanSkillsFolder(
  skillsDir: string,
  relPrefix: string,
): Promise<UpstreamSourceSkill[]> {
  if (!(await pathExists(skillsDir))) return [];
  const results: UpstreamSourceSkill[] = [];
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!(await pathExists(skillMdPath))) continue;
    try {
      const raw = await fs.readFile(skillMdPath, "utf8");
      const parsed = parseSkillMd(raw, entry.name);
      results.push({
        name: parsed.metadata.name || entry.name,
        ...(parsed.metadata.description ? { description: parsed.metadata.description } : {}),
        pathInSource: `${relPrefix}/${entry.name}/SKILL.md`,
        ...(parsed.metadata.deprecated ? { deprecated: true } : {}),
        ...(parsed.metadata.deprecationReason
          ? { deprecationReason: parsed.metadata.deprecationReason }
          : {}),
        ...(parsed.metadata.replacedBy ? { replacedBy: parsed.metadata.replacedBy } : {}),
      });
    } catch {
      // Ignore unreadable SKILL.md
    }
  }
  return results;
}

function parseGithubSlug(sourceRepo?: string): string | null {
  if (!sourceRepo) return null;
  const match = sourceRepo.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}

async function fetchGithubSkillsTree(slug: string): Promise<UpstreamSourceSkill[] | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/git/trees/HEAD?recursive=1`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "harness-control" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      truncated?: boolean;
      tree?: Array<{ path?: string; type?: string }>;
    };
    if (!Array.isArray(data.tree)) return null;

    const skills: UpstreamSourceSkill[] = [];
    for (const node of data.tree) {
      if (node.type !== "blob" || !node.path) continue;
      const m = node.path.match(/^(?:skills\/)?([^/]+)\/SKILL\.md$/);
      if (m?.[1]) {
        skills.push({
          name: m[1],
          pathInSource: node.path,
        });
      }
    }
    return skills;
  } catch {
    return null;
  }
}

export class SourceCatalogAdapter implements SourceCatalogPort {
  constructor(private readonly homeOverride?: string) {}

  async discoverCatalogs(
    installedSkills: readonly SkillRecord[],
    checkRemote: boolean,
  ): Promise<readonly UpstreamSourceCatalog[]> {
    const catalogs = new Map<string, UpstreamSourceCatalog>();
    const inspectedRepos = new Set<string>();

    // 1. Inspect local git roots of installed skills (catches sibling skills in cloned repos)
    for (const skill of installedSkills) {
      const candidatePath = skill.exposures[0]?.symlinkTarget ?? skill.exposures[0]?.path;
      if (!candidatePath) continue;

      const repoRoot = await findGitRoot(candidatePath);
      if (repoRoot && !inspectedRepos.has(repoRoot)) {
        inspectedRepos.add(repoRoot);
        const inSkillsDir = await scanSkillsFolder(path.join(repoRoot, "skills"), "skills");
        const inRoot = await scanSkillsFolder(repoRoot, ".");
        const merged = [...inSkillsDir, ...inRoot];
        if (merged.length > 0) {
          const key = skill.provenance.sourceRepo ?? skill.provenance.author;
          catalogs.set(key, {
            sourceId: key,
            author: skill.provenance.author,
            ...(skill.provenance.sourceRepo ? { sourceRepo: skill.provenance.sourceRepo } : {}),
            owningManager: skill.provenance.owningManager,
            catalogComplete: true,
            skills: merged,
          });
        }
      }
    }

    // 2. Inspect local Claude plugin marketplaces cache (~/.claude/plugins/marketplaces/*)
    const home = this.homeOverride ?? os.homedir();
    const marketplacesDir = path.join(home, ".claude", "plugins", "marketplaces");
    if (await pathExists(marketplacesDir)) {
      try {
        const entries = await fs.readdir(marketplacesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const mktRoot = path.join(marketplacesDir, entry.name);
          const skills = await scanSkillsFolder(path.join(mktRoot, "skills"), "skills");
          if (skills.length > 0) {
            catalogs.set(`marketplace:${entry.name}`, {
              sourceId: `marketplace:${entry.name}`,
              author: entry.name,
              marketplaceName: entry.name,
              owningManager: "claude-plugin",
              catalogComplete: true,
              skills,
            });
          }
        }
      } catch {
        // Ignore unreadable marketplace directory
      }
    }

    // 3. Optional remote GitHub tree check for sources not already resolved locally
    if (checkRemote) {
      for (const skill of installedSkills) {
        const sourceRepo = skill.provenance.sourceRepo;
        if (!sourceRepo || catalogs.has(sourceRepo)) continue;
        const slug = parseGithubSlug(sourceRepo);
        if (!slug) continue;
        const remoteSkills = await fetchGithubSkillsTree(slug);
        if (remoteSkills && remoteSkills.length > 0) {
          catalogs.set(sourceRepo, {
            sourceId: sourceRepo,
            author: skill.provenance.author,
            sourceRepo,
            owningManager: skill.provenance.owningManager,
            catalogComplete: true,
            skills: remoteSkills,
          });
        }
      }
    }

    return Array.from(catalogs.values());
  }
}
