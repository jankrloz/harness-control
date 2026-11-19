import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConfigPort, HarnessManagerConfig } from "../application/index.js";

export class ConfigStore implements ConfigPort {
  private readonly configPath: string;

  constructor(configPath?: string) {
    const xdg = process.env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
    this.configPath = configPath ?? path.join(xdg, "harness-control", "config.json");
  }

  async loadConfig(): Promise<HarnessManagerConfig> {
    try {
      const raw = await fs.readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<HarnessManagerConfig>;
      return {
        workspaceRoots: Array.isArray(parsed.workspaceRoots)
          ? parsed.workspaceRoots
          : [path.join(os.homedir(), "dev")],
        customHarnesses: Array.isArray(parsed.customHarnesses) ? parsed.customHarnesses : [],
        maxScanDepth: typeof parsed.maxScanDepth === "number" ? parsed.maxScanDepth : 4,
        checkRemoteUpdates: Boolean(parsed.checkRemoteUpdates),
      };
    } catch {
      return {
        workspaceRoots: [path.join(os.homedir(), "dev")],
        customHarnesses: [],
        maxScanDepth: 4,
        checkRemoteUpdates: false,
      };
    }
  }

  async saveConfig(config: HarnessManagerConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}
