import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  NativeCliPort,
  NativeCliScanResult,
  NativeCliSkillEntry,
} from "../application/index.js";
import type { HarnessDefinition, PackageManager } from "../domain/index.js";

const execFileAsync = promisify(execFile);

async function runCliSafe(
  command: string,
  args: readonly string[],
  timeoutMs = 6000,
): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export class NativeCliAdapter implements NativeCliPort {
  constructor(private readonly homeOverride?: string) {}

  async discoverAll(harnesses: readonly HarnessDefinition[]): Promise<NativeCliScanResult> {
    const entries: NativeCliSkillEntry[] = [];
    const warnings: string[] = [];

    const [apmEntries, npxEntries, lockfileEntries, harnessCliEntries] = await Promise.all([
      this.discoverApm(),
      this.discoverNpxSkills(),
      this.discoverGlobalLockfiles(),
      this.discoverHarnessClis(harnesses),
    ]);

    entries.push(...apmEntries, ...npxEntries, ...lockfileEntries, ...harnessCliEntries);

    return { entries, warnings };
  }

  private async discoverApm(): Promise<NativeCliSkillEntry[]> {
    const res = await runCliSafe("apm", ["list", "--json"]);
    if (!res.ok || !res.stdout.trim()) return [];
    try {
      const parsed = JSON.parse(res.stdout) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
        .map((item) => ({
          name: String(item["name"] ?? ""),
          owningManager: "apm" as PackageManager,
          ...(item["id"] ? { managedId: String(item["id"]) } : {}),
          ...(item["version"] ? { version: String(item["version"]) } : {}),
          ...(item["repo"] ? { sourceRepo: String(item["repo"]) } : {}),
          updateAvailable: Boolean(item["updateAvailable"]),
        }))
        .filter((e) => e.name.length > 0);
    } catch {
      return [];
    }
  }

  private async discoverNpxSkills(): Promise<NativeCliSkillEntry[]> {
    const res = await runCliSafe("npx", ["--no-install", "skills", "ls", "--json"]);
    if (!res.ok || !res.stdout.trim()) return [];
    try {
      const parsed = JSON.parse(res.stdout) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
        .map((item) => ({
          name: String(item["name"] ?? ""),
          owningManager: "npx-skills" as PackageManager,
          ...(item["source"] ? { sourceRepo: String(item["source"]) } : {}),
          ...(item["id"] ? { managedId: String(item["id"]) } : {}),
        }))
        .filter((e) => e.name.length > 0);
    } catch {
      return [];
    }
  }

  private async discoverGlobalLockfiles(): Promise<NativeCliSkillEntry[]> {
    const home = this.homeOverride ?? os.homedir();
    const lockPath = path.join(home, ".agents", ".skill-lock.json");
    try {
      const raw = await fs.readFile(lockPath, "utf8");
      const parsed = JSON.parse(raw) as { skills?: Record<string, Record<string, unknown>> };
      if (!parsed.skills || typeof parsed.skills !== "object") return [];
      return Object.entries(parsed.skills).map(([name, info]) => ({
        name,
        owningManager: "npx-skills",
        managedId: name,
        ...(typeof info["source"] === "string" ? { sourceRepo: info["source"] } : {}),
        ...(typeof info["version"] === "string" ? { version: info["version"] } : {}),
      }));
    } catch {
      return [];
    }
  }

  private async discoverHarnessClis(
    harnesses: readonly HarnessDefinition[],
  ): Promise<NativeCliSkillEntry[]> {
    const entries: NativeCliSkillEntry[] = [];
    for (const h of harnesses) {
      if (!h.cliBinary || !h.listCommand) continue;
      const res = await runCliSafe(h.cliBinary, h.listCommand);
      if (!res.ok || !res.stdout.trim()) continue;

      if (h.id === "claude") {
        try {
          const parsed = JSON.parse(res.stdout) as unknown;
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (!item || typeof item !== "object") continue;
              const obj = item as Record<string, unknown>;
              const name = String(obj["name"] ?? obj["id"] ?? "");
              if (!name) continue;
              entries.push({
                name,
                owningManager: "claude-plugin",
                managedId: String(obj["id"] ?? name),
                harnessId: "claude",
                ...(obj["version"] ? { version: String(obj["version"]) } : {}),
              });
            }
          }
        } catch {
          // Non-JSON output ignored safely
        }
      }
    }
    return entries;
  }
}
