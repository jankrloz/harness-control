import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveredSkillExposure, SkillScannerPort } from "../application/index.js";
import type { HarnessDefinition, LinkType, PackageManager, Scope } from "../domain/index.js";
import { parseSkillMd } from "./skill-md-parser.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "target", ".venv", "venv"]);

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function inspectSkillEntry(
  entryPath: string,
  skillName: string,
  harnessId: string,
  scope: Scope,
  projectRoot?: string,
  hintedManager?: PackageManager,
  profile?: string,
): Promise<DiscoveredSkillExposure | null> {
  let lstat;
  try {
    lstat = await fs.lstat(entryPath);
  } catch {
    return null;
  }

  let linkType: LinkType = "physical-copy";
  let symlinkTarget: string | undefined;
  let resolvedPath = entryPath;

  if (lstat.isSymbolicLink()) {
    const rawTarget = await fs.readlink(entryPath);
    const target = path.isAbsolute(rawTarget)
      ? rawTarget
      : path.resolve(path.dirname(entryPath), rawTarget);
    symlinkTarget = target;
    if (await pathExists(target)) {
      linkType = "symlink-healthy";
      resolvedPath = target;
    } else {
      linkType = "symlink-broken";
      return {
        skillName,
        harnessId,
        scope,
        ...(profile ? { profile } : {}),
        path: entryPath,
        skillFilePath: path.join(entryPath, "SKILL.md"),
        linkType,
        symlinkTarget: target,
        ...(projectRoot ? { projectRoot } : {}),
        ...(hintedManager ? { hintedManager } : {}),
      };
    }
  } else if (!lstat.isDirectory()) {
    return null;
  }

  const skillFilePath = path.join(resolvedPath, "SKILL.md");
  if (!(await pathExists(skillFilePath))) {
    return null;
  }

  const [rawContent, fileStat] = await Promise.all([
    fs.readFile(skillFilePath, "utf8"),
    fs.stat(skillFilePath).catch(() => null),
  ]);
  const contentHash = crypto.createHash("sha256").update(rawContent).digest("hex");
  const parsed = parseSkillMd(rawContent, skillName);
  const modifiedAt = fileStat ? new Date(fileStat.mtimeMs).toISOString() : undefined;
  const version = parsed.metadata.version;

  return {
    skillName: parsed.metadata.name || skillName,
    harnessId,
    scope,
    ...(profile ? { profile } : {}),
    path: entryPath,
    skillFilePath,
    linkType,
    ...(symlinkTarget ? { symlinkTarget } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    contentHash,
    ...(modifiedAt ? { modifiedAt } : {}),
    ...(version ? { version } : {}),
    rawContent,
    frontmatterRaw: parsed.frontmatterRaw,
    bodyRaw: parsed.bodyRaw,
    metadata: parsed.metadata,
    ...(hintedManager ? { hintedManager } : {}),
  };
}

function inferProfileFromGlobalDir(dir: string): string | undefined {
  const normalized = dir.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)\.claude-([^/]+)\/skills\/?$/);
  return match?.[1];
}

async function scanSkillDirectory(
  dir: string,
  harnessId: string,
  scope: Scope,
  projectRoot?: string,
  hintedManager?: PackageManager,
  profile?: string,
): Promise<DiscoveredSkillExposure[]> {
  if (!(await pathExists(dir))) {
    return [];
  }
  const results: DiscoveredSkillExposure[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const fullEntryPath = path.join(dir, entry.name);
    const exposure = await inspectSkillEntry(
      fullEntryPath,
      entry.name,
      harnessId,
      scope,
      projectRoot,
      hintedManager,
      profile,
    );
    if (exposure) {
      results.push(exposure);
    }
  }

  return results;
}

async function detectProjectManagerHint(projectRoot: string): Promise<PackageManager | undefined> {
  if (await pathExists(path.join(projectRoot, "apm.yml"))) return "apm";
  if (await pathExists(path.join(projectRoot, "skills-lock.json"))) return "npx-skills";
  return undefined;
}

export class FsSkillScanner implements SkillScannerPort {
  async scanGlobalHarnesses(
    harnesses: readonly HarnessDefinition[],
  ): Promise<readonly DiscoveredSkillExposure[]> {
    const all: DiscoveredSkillExposure[] = [];
    for (const harness of harnesses) {
      for (const dir of harness.globalSkillDirs) {
        const profile = inferProfileFromGlobalDir(dir);
        const found = await scanSkillDirectory(
          dir,
          harness.id,
          "global",
          undefined,
          undefined,
          profile,
        );
        all.push(...found);
      }
    }
    return all;
  }

  async scanWorkspaces(
    workspaceRoots: readonly string[],
    harnesses: readonly HarnessDefinition[],
    maxDepth: number,
  ): Promise<readonly DiscoveredSkillExposure[]> {
    const results: DiscoveredSkillExposure[] = [];
    const seenProjectSkillPaths = new Set<string>();

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      const managerHint = await detectProjectManagerHint(dir);

      for (const harness of harnesses) {
        for (const relSkillDir of harness.projectSkillDirs) {
          const candidateDir = path.join(dir, relSkillDir);
          if (await pathExists(candidateDir)) {
            const found = await scanSkillDirectory(
              candidateDir,
              harness.id,
              "project",
              dir,
              managerHint,
            );
            for (const item of found) {
              const dedupKey = `${harness.id}:${item.path}`;
              if (!seenProjectSkillPaths.has(dedupKey)) {
                seenProjectSkillPaths.add(dedupKey);
                results.push(item);
              }
            }
          }
        }
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name), depth + 1);
      }
    };

    for (const root of workspaceRoots) {
      if (await pathExists(root)) {
        await walk(root, 0);
      }
    }

    return results;
  }
}
