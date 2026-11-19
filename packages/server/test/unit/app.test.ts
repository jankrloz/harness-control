import { describe, expect, it } from "vitest";
import {
  ActionService,
  InventoryService,
  type CommandExecutorPort,
  type ConfigPort,
  type GitInspectorPort,
  type NativeCliPort,
  type SkillScannerPort,
  TiktokenCounter,
} from "@harness-control/core";
import { createServerApp } from "../../src/app.js";

describe("server API", () => {
  it("returns health, inventory, and dry-run remove preview", async () => {
    const scanner: SkillScannerPort = {
      scanGlobalHarnesses: async () => [
        {
          skillName: "demo-skill",
          harnessId: "claude",
          scope: "global",
          path: "/tmp/.claude/skills/demo-skill",
          skillFilePath: "/tmp/.claude/skills/demo-skill/SKILL.md",
          linkType: "physical-copy",
          rawContent: "---\nname: demo-skill\ndescription: Demo\n---\n# Demo\n",
          frontmatterRaw: "name: demo-skill\ndescription: Demo",
          bodyRaw: "# Demo\n",
          metadata: {
            name: "demo-skill",
            description: "Demo",
            author: "acme",
            rawFrontmatter: {},
          },
        },
      ],
      scanWorkspaces: async () => [],
    };
    const cli: NativeCliPort = {
      discoverAll: async () => ({
        entries: [{ name: "demo-skill", owningManager: "apm", managedId: "acme/demo-skill" }],
        warnings: [],
      }),
    };
    const git: GitInspectorPort = { inspectPath: async () => null };
    const executor: CommandExecutorPort = {
      executeCommand: async (cmd) => ({ ...cmd, exitCode: 0, stdout: "", stderr: "" }),
      applyPathChange: async () => undefined,
    };
    const configStore: ConfigPort = {
      loadConfig: async () => ({
        workspaceRoots: [],
        customHarnesses: [],
        maxScanDepth: 2,
        checkRemoteUpdates: false,
      }),
      saveConfig: async () => undefined,
    };

    const app = createServerApp({
      inventoryService: new InventoryService(scanner, cli, new TiktokenCounter(), git),
      actionService: new ActionService(executor),
      configStore,
    });

    const healthRes = await app.request("/api/health");
    expect(healthRes.status).toBe(200);

    const invRes = await app.request("/api/inventory");
    expect(invRes.status).toBe(200);
    const invBody = (await invRes.json()) as {
      snapshot: { skills: Array<{ id: string }> };
      telemetry: { totalUniqueSkills: number };
    };
    expect(invBody.telemetry.totalUniqueSkills).toBe(1);
    const skillId = invBody.snapshot.skills[0]!.id;

    const previewRes = await app.request("/api/actions/remove/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId }),
    });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { commands: Array<{ command: string }> };
    expect(preview.commands[0]?.command).toBe("apm");
  });
});
