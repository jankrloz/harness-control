import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessDefinition } from "../domain/index.js";

function homeDir(overrideHome?: string): string {
  return overrideHome ?? os.homedir();
}

export function discoverClaudeConfigDirs(overrideHome?: string): readonly string[] {
  const home = homeDir(overrideHome);
  const dirs = new Set<string>([
    process.env["CLAUDE_CONFIG_DIR"] || path.join(home, ".claude"),
    path.join(home, ".claude"),
  ]);
  try {
    for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".claude-")) {
        dirs.add(path.join(home, entry.name));
      }
    }
  } catch {
    // Ignore unreadable home dir
  }
  return Array.from(dirs);
}

export function getBuiltinHarnesses(overrideHome?: string): readonly HarnessDefinition[] {
  const home = homeDir(overrideHome);
  const xdgConfig = process.env["XDG_CONFIG_HOME"] || path.join(home, ".config");
  const claudeGlobalDirs = discoverClaudeConfigDirs(home).map((d) => path.join(d, "skills"));
  const codexHome = process.env["CODEX_HOME"] || path.join(home, ".codex");

  return [
    // Full harness coverage
    {
      id: "claude",
      displayName: "Claude Code",
      supportLevel: "full",
      globalSkillDirs: claudeGlobalDirs,
      projectSkillDirs: [".claude/skills", ".agents/skills"],
      cliBinary: "claude",
      listCommand: ["plugin", "list", "--json"],
      supportedPrimitives: ["skill", "mcp", "hook", "command", "lsp", "prompt"],
    },
    {
      id: "copilot-app",
      displayName: "Copilot App",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".copilot", "skills")],
      projectSkillDirs: [".github/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp", "prompt"],
    },
    {
      id: "copilot-cowork",
      displayName: "Copilot Cowork",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".copilot-cowork", "skills")],
      projectSkillDirs: [".copilot-cowork/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp"],
    },
    {
      id: "gemini",
      displayName: "Gemini CLI",
      supportLevel: "full",
      globalSkillDirs: [
        path.join(home, ".gemini", "skills"),
        path.join(home, ".gemini", "antigravity", "skills"),
      ],
      projectSkillDirs: [".gemini/skills", ".agents/skills"],
      cliBinary: "gemini",
      listCommand: ["extensions", "list"],
      supportedPrimitives: ["skill", "mcp", "command"],
    },
    {
      id: "grok-bot",
      displayName: "Grok Bot",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".grok-bot", "skills")],
      projectSkillDirs: [".grok-bot/skills", ".agents/skills"],
      supportedPrimitives: ["skill"],
    },
    {
      id: "grok-build",
      displayName: "Grok Build",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".grok-build", "skills")],
      projectSkillDirs: [".grok-build/skills", ".agents/skills"],
      supportedPrimitives: ["skill"],
    },
    {
      id: "grok-cloud",
      displayName: "Grok Cloud",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".grok-cloud", "skills")],
      projectSkillDirs: [".grok-cloud/skills", ".agents/skills"],
      supportedPrimitives: ["skill"],
    },
    {
      id: "hermes",
      displayName: "Hermes",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".hermes", "skills")],
      projectSkillDirs: [".hermes/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp", "command"],
    },
    {
      id: "kiro",
      displayName: "Kiro",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".kiro", "skills")],
      projectSkillDirs: [".kiro/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp", "hook"],
    },
    {
      id: "openclaw",
      displayName: "OpenClaw",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".openclaw", "skills")],
      projectSkillDirs: [".openclaw/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp"],
    },
    {
      id: "pi",
      displayName: "Pi",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".pi", "agent", "skills")],
      projectSkillDirs: [".pi/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "command"],
    },
    {
      id: "deepseek",
      displayName: "DeepSeek",
      supportLevel: "full",
      globalSkillDirs: [path.join(home, ".deepseek", "skills")],
      projectSkillDirs: [".deepseek/skills", ".agents/skills"],
      supportedPrimitives: ["skill"],
    },

    // Partially supported / emerging harnesses
    {
      id: "antigravity",
      displayName: "Antigravity",
      supportLevel: "partial",
      globalSkillDirs: [
        path.join(home, ".gemini", "config", "skills"),
        path.join(home, ".gemini", "antigravity", "builtin", "skills"),
      ],
      projectSkillDirs: [".gemini/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp", "command", "hook"],
    },
    {
      id: "codex",
      displayName: "Codex",
      supportLevel: "partial",
      globalSkillDirs: [path.join(codexHome, "skills"), path.join(home, ".agents", "skills")],
      projectSkillDirs: [".codex/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp"],
    },
    {
      id: "copilot",
      displayName: "GitHub Copilot",
      supportLevel: "partial",
      globalSkillDirs: [path.join(xdgConfig, "github-copilot", "skills")],
      projectSkillDirs: [".github/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "prompt"],
    },
    {
      id: "cursor",
      displayName: "Cursor",
      supportLevel: "partial",
      globalSkillDirs: [path.join(home, ".cursor", "skills")],
      projectSkillDirs: [".cursor/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp", "command"],
    },
    {
      id: "opencode",
      displayName: "OpenCode",
      supportLevel: "partial",
      globalSkillDirs: [path.join(xdgConfig, "opencode", "skills")],
      projectSkillDirs: [".opencode/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp", "lsp"],
    },
    {
      id: "windsurf",
      displayName: "Windsurf",
      supportLevel: "partial",
      globalSkillDirs: [path.join(home, ".codeium", "windsurf", "skills")],
      projectSkillDirs: [".windsurf/skills", ".agents/skills"],
      supportedPrimitives: ["skill", "mcp"],
    },
  ];
}

export function resolveHarnesses(
  customHarnesses: readonly HarnessDefinition[],
  overrideHome?: string,
): readonly HarnessDefinition[] {
  const map = new Map<string, HarnessDefinition>();
  for (const h of getBuiltinHarnesses(overrideHome)) {
    map.set(h.id, h);
  }
  for (const custom of customHarnesses) {
    map.set(custom.id, custom);
  }
  return Array.from(map.values());
}
