import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SkillUsagePort } from "../application/index.js";
import type { SkillUsageInfo } from "../domain/index.js";
import { discoverClaudeConfigDirs } from "./harness-registry.js";

const SKILL_MD_PATH_RE = /skills\/([a-zA-Z0-9._-]+)\/SKILL\.md/g;
const CLAUDE_SKILL_CALL_RE = /"name"\s*:\s*"Skill"[^}]*"skill"\s*:\s*"([^"]+)"/g;

async function collectRecentJsonlFiles(
  rootDir: string,
  maxDepth: number,
  maxFiles: number,
): Promise<Array<{ path: string; mtimeMs: number }>> {
  const found: Array<{ path: string; mtimeMs: number }> = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const st = await fs.stat(full);
          found.push({ path: full, mtimeMs: st.mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  };

  await walk(rootDir, 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, maxFiles);
}

export class UsageLogInspector implements SkillUsagePort {
  constructor(private readonly homeOverride?: string) {}

  async collectUsage(): Promise<ReadonlyMap<string, SkillUsageInfo>> {
    const home = this.homeOverride ?? os.homedir();
    const sources: Array<{ dir: string; harness: string; depth: number }> = [
      ...discoverClaudeConfigDirs(home).map((d) => ({
        dir: path.join(d, "projects"),
        harness: "claude",
        depth: 2,
      })),
      { dir: path.join(home, ".codex", "sessions"), harness: "codex", depth: 4 },
      { dir: path.join(home, ".gemini", "antigravity", "brain"), harness: "antigravity", depth: 3 },
    ];

    const usage = new Map<
      string,
      { lastUsedMs: number; activationCount: number; lastHarness: string }
    >();

    for (const src of sources) {
      const files = await collectRecentJsonlFiles(src.dir, src.depth, 30);
      for (const file of files) {
        let content: string;
        try {
          content = await fs.readFile(file.path, "utf8");
        } catch {
          continue;
        }

        const seenInFile = new Set<string>();
        for (const match of content.matchAll(SKILL_MD_PATH_RE)) {
          if (match[1]) seenInFile.add(match[1].toLowerCase());
        }
        for (const match of content.matchAll(CLAUDE_SKILL_CALL_RE)) {
          if (match[1]) {
            const rawName = match[1].split(":").pop() ?? match[1];
            seenInFile.add(rawName.toLowerCase());
          }
        }

        for (const skillName of seenInFile) {
          const cur = usage.get(skillName) ?? {
            lastUsedMs: 0,
            activationCount: 0,
            lastHarness: src.harness,
          };
          cur.activationCount += 1;
          if (file.mtimeMs >= cur.lastUsedMs) {
            cur.lastUsedMs = file.mtimeMs;
            cur.lastHarness = src.harness;
          }
          usage.set(skillName, cur);
        }
      }
    }

    const result = new Map<string, SkillUsageInfo>();
    for (const [key, val] of usage.entries()) {
      result.set(key, {
        activationCount: val.activationCount,
        ...(val.lastUsedMs > 0 ? { lastUsedAt: new Date(val.lastUsedMs).toISOString() } : {}),
        lastHarness: val.lastHarness,
      });
    }
    return result;
  }
}
