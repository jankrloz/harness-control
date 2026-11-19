import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  HarnessId,
  McpServerEntry,
  PackageManager,
  PrimitiveEntry,
  PrimitiveExposure,
  PrimitivesSnapshot,
  SessionDetail,
  SessionMessage,
  SessionSummary,
  UsageDashboardSnapshot,
  UsageHourlyBucket,
  UsageModelBreakdown,
  UsageRequestLog,
} from "../domain/index.js";
import { discoverClaudeConfigDirs } from "./harness-registry.js";

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function listFilesSafe(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function collectFilesRecursive(
  dir: string,
  maxDepth: number,
  ext: string,
): Promise<Array<{ file: string; mtimeMs: number }>> {
  const out: Array<{ file: string; mtimeMs: number }> = [];
  const walk = async (cur: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith(ext)) {
        try {
          const st = await fs.stat(full);
          out.push({ file: full, mtimeMs: st.mtimeMs });
        } catch {
          // Ignore unreadable
        }
      }
    }
  };
  await walk(dir, 0);
  return out;
}

function inferPrimitiveManager(
  filePath: string,
  apmManagedNames?: Set<string>,
  name?: string,
): PackageManager {
  if (name && apmManagedNames?.has(name.toLowerCase())) return "apm";
  if (filePath.includes("/.apm/") || filePath.includes("/apm_modules/")) return "apm";
  if (filePath.includes("/.claude/plugins") || filePath.includes("/plugins/marketplaces")) {
    return "claude-plugin";
  }
  if (filePath.includes("/.gemini/extensions")) return "gemini-extension";
  return "manual";
}

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function estimateFileTokens(filePath: string, fallbackText: string): Promise<number> {
  try {
    const st = await fs.stat(filePath);
    return Math.max(1, Math.ceil(st.size / 4));
  } catch {
    return estimateTokensFromText(fallbackText);
  }
}

function addMcpMap(
  map: Map<
    string,
    {
      name: string;
      commandOrUrl: string;
      transport: "stdio" | "http" | "sse";
      harnesses: Set<HarnessId>;
      configPaths: Set<string>;
      exposures: PrimitiveExposure[];
      variants: Set<string>;
      rawChars: number;
    }
  >,
  serversObj: unknown,
  harnessId: HarnessId,
  configPath: string,
) {
  if (!serversObj || typeof serversObj !== "object" || Array.isArray(serversObj)) return;
  for (const [name, rawCfg] of Object.entries(serversObj as Record<string, unknown>)) {
    if (!rawCfg || typeof rawCfg !== "object") continue;
    const cfg = rawCfg as Record<string, unknown>;
    const url =
      typeof cfg["url"] === "string"
        ? cfg["url"]
        : typeof cfg["serverUrl"] === "string"
          ? cfg["serverUrl"]
          : undefined;
    const cmd = typeof cfg["command"] === "string" ? cfg["command"] : undefined;
    const args = Array.isArray(cfg["args"])
      ? cfg["args"].filter((a): a is string => typeof a === "string").join(" ")
      : "";
    const commandOrUrl = url ?? (cmd ? `${cmd}${args ? ` ${args}` : ""}` : "configured");
    const transport: "stdio" | "http" | "sse" = url
      ? url.includes("sse")
        ? "sse"
        : "http"
      : "stdio";
    const exposure: PrimitiveExposure = {
      harnessId,
      scope: "global",
      path: configPath,
      detail: commandOrUrl,
    };
    const cfgSize = JSON.stringify(rawCfg).length;

    const existing = map.get(name);
    if (existing) {
      existing.harnesses.add(harnessId);
      existing.configPaths.add(configPath);
      existing.exposures.push(exposure);
      existing.variants.add(commandOrUrl);
      existing.rawChars = Math.max(existing.rawChars, cfgSize);
    } else {
      map.set(name, {
        name,
        commandOrUrl,
        transport,
        harnesses: new Set([harnessId]),
        configPaths: new Set([configPath]),
        exposures: [exposure],
        variants: new Set([commandOrUrl]),
        rawChars: cfgSize,
      });
    }
  }
}

export async function scanPrimitives(homeOverride?: string): Promise<PrimitivesSnapshot> {
  const home = homeOverride ?? os.homedir();
  const apmManagedNames = new Set<string>();
  try {
    const rawApm = await fs.readFile(path.join(home, ".apm", "apm.yml"), "utf8");
    for (const line of rawApm.split(/\r?\n/)) {
      const m = line.match(/^\s*-\s+([^\s#]+)/);
      if (m?.[1]) {
        const last = m[1].split("/").pop()?.replace(/#.*$/, "");
        if (last) apmManagedNames.add(last.toLowerCase());
      }
    }
  } catch {
    // No global apm.yml
  }

  const mcpMap = new Map<
    string,
    {
      name: string;
      commandOrUrl: string;
      transport: "stdio" | "http" | "sse";
      harnesses: Set<HarnessId>;
      configPaths: Set<string>;
      exposures: PrimitiveExposure[];
      variants: Set<string>;
      rawChars: number;
    }
  >();

  const claudeDirs = discoverClaudeConfigDirs(home);
  const jsonMcpSources: Array<{ file: string; harness: HarnessId; keys: string[] }> = [
    { file: path.join(home, ".claude.json"), harness: "claude", keys: ["mcpServers"] },
    ...claudeDirs.map((d) => ({
      file: path.join(d, "settings.json"),
      harness: "claude" as HarnessId,
      keys: ["mcpServers"],
    })),
    { file: path.join(home, ".gemini", "settings.json"), harness: "gemini", keys: ["mcpServers"] },
    {
      file: path.join(home, ".gemini", "antigravity", "mcp_config.json"),
      harness: "antigravity",
      keys: ["mcpServers"],
    },
    {
      file: path.join(home, ".config", "opencode", "opencode.json"),
      harness: "opencode",
      keys: ["mcp", "mcpServers"],
    },
    { file: path.join(home, ".cursor", "mcp.json"), harness: "cursor", keys: ["mcpServers"] },
  ];

  await Promise.all(
    jsonMcpSources.map(async (src) => {
      const data = await readJsonSafe(src.file);
      if (!data) return;
      for (const key of src.keys) {
        addMcpMap(mcpMap, data[key], src.harness, src.file);
      }
    }),
  );

  // Parse Codex TOML [mcp_servers.<name>]
  const codexTomlPath = path.join(home, ".codex", "config.toml");
  try {
    const rawToml = await fs.readFile(codexTomlPath, "utf8");
    const matches = rawToml.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm);
    for (const m of matches) {
      const name = m[1]?.trim();
      if (!name) continue;
      addMcpMap(mcpMap, { [name]: { command: "codex-toml" } }, "codex", codexTomlPath);
    }
  } catch {
    // No codex config.toml
  }

  const mcpServers: McpServerEntry[] = Array.from(mcpMap.values())
    .map((m) => {
      const hasDrift = m.variants.size > 1;
      const firstPath = Array.from(m.configPaths)[0] ?? "";
      return {
        id: `mcp:${m.name}`,
        name: m.name,
        commandOrUrl: m.commandOrUrl,
        transport: m.transport,
        harnesses: Array.from(m.harnesses).sort(),
        configPaths: Array.from(m.configPaths),
        scope: "global" as const,
        owningManager: inferPrimitiveManager(firstPath, apmManagedNames, m.name),
        exposures: m.exposures,
        hasDrift,
        ...(hasDrift
          ? { driftSummary: `${m.variants.size} differing configs across harnesses` }
          : {}),
        estimatedTokens: Math.max(12, Math.ceil(m.rawChars / 4)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Commands & Prompts
  const commands: PrimitiveEntry[] = [];
  const prompts: PrimitiveEntry[] = [];
  const hooks: PrimitiveEntry[] = [];
  const lsps: PrimitiveEntry[] = [];

  const cmdDirs: Array<{ dir: string; harness: HarnessId; kind: "command" | "prompt" }> = [
    ...claudeDirs.map((d) => ({
      dir: path.join(d, "commands"),
      harness: "claude" as HarnessId,
      kind: "command" as const,
    })),
    { dir: path.join(home, ".gemini", "commands"), harness: "gemini", kind: "command" },
    { dir: path.join(home, ".codex", "prompts"), harness: "codex", kind: "prompt" },
    { dir: path.join(home, ".claude", "prompts"), harness: "claude", kind: "prompt" },
  ];

  for (const cd of cmdDirs) {
    const files = await listFilesSafe(cd.dir);
    for (const file of files) {
      const name = path.basename(file).replace(/\.(md|toml)$/i, "");
      const estimatedTokens = await estimateFileTokens(file, name);
      const entry: PrimitiveEntry = {
        id: `${cd.harness}:${cd.kind}:${path.basename(file)}`,
        kind: cd.kind,
        name,
        harnessId: cd.harness,
        path: file,
        scope: "global",
        owningManager: inferPrimitiveManager(file, apmManagedNames, name),
        exposures: [{ harnessId: cd.harness, scope: "global", path: file }],
        hasDrift: false,
        estimatedTokens,
      };
      if (cd.kind === "command") commands.push(entry);
      else prompts.push(entry);
    }
  }

  // Hooks from Claude settings.json
  for (const d of claudeDirs) {
    const settingsPath = path.join(d, "settings.json");
    const data = await readJsonSafe(settingsPath);
    const rawHooks = data?.["hooks"];
    if (rawHooks && typeof rawHooks === "object" && !Array.isArray(rawHooks)) {
      for (const [hookEvent, list] of Object.entries(rawHooks as Record<string, unknown>)) {
        const detail = Array.isArray(list) ? `${list.length} matcher(s)` : "configured";
        hooks.push({
          id: `claude:hook:${hookEvent}:${settingsPath}`,
          kind: "hook",
          name: hookEvent,
          harnessId: "claude",
          path: settingsPath,
          detail,
          scope: "global",
          owningManager: inferPrimitiveManager(settingsPath, apmManagedNames, hookEvent),
          exposures: [{ harnessId: "claude", scope: "global", path: settingsPath, detail }],
          hasDrift: false,
          estimatedTokens: estimateTokensFromText(JSON.stringify(list ?? detail)),
        });
      }
    }
  }

  // LSPs from opencode.json
  const openCodePath = path.join(home, ".config", "opencode", "opencode.json");
  const openCodeData = await readJsonSafe(openCodePath);
  const rawLsp = openCodeData?.["lsp"];
  if (rawLsp && typeof rawLsp === "object" && !Array.isArray(rawLsp)) {
    for (const [lang, cfg] of Object.entries(rawLsp as Record<string, unknown>)) {
      const detail = cfg && typeof cfg === "object" ? "configured" : String(cfg);
      lsps.push({
        id: `opencode:lsp:${lang}`,
        kind: "lsp",
        name: lang,
        harnessId: "opencode",
        path: openCodePath,
        detail,
        scope: "global",
        owningManager: inferPrimitiveManager(openCodePath, apmManagedNames, lang),
        exposures: [{ harnessId: "opencode", scope: "global", path: openCodePath, detail }],
        hasDrift: false,
        estimatedTokens: estimateTokensFromText(JSON.stringify(cfg ?? detail)),
      });
    }
  }

  // Cross-harness duplicate / drift annotation for commands, prompts, hooks, lsps
  const annotateDuplicates = (entries: PrimitiveEntry[]): PrimitiveEntry[] => {
    const byName = new Map<string, PrimitiveEntry[]>();
    for (const e of entries) {
      const key = e.name.toLowerCase();
      const arr = byName.get(key) ?? [];
      arr.push(e);
      byName.set(key, arr);
    }
    return entries.map((e) => {
      const siblings = byName.get(e.name.toLowerCase()) ?? [e];
      if (siblings.length <= 1) return e;
      const details = new Set(siblings.map((s) => s.detail ?? `${s.estimatedTokens}`));
      const hasDiff = details.size > 1;
      return {
        ...e,
        hasDrift: hasDiff,
        driftSummary: hasDiff
          ? `${siblings.length} copies with differing definitions`
          : `${siblings.length} duplicate copies across paths`,
        exposures: siblings.flatMap((s) => s.exposures),
      };
    });
  };

  const finalCommands = annotateDuplicates(commands).sort((a, b) => a.name.localeCompare(b.name));
  const finalPrompts = annotateDuplicates(prompts).sort((a, b) => a.name.localeCompare(b.name));
  const finalHooks = annotateDuplicates(hooks).sort((a, b) => a.name.localeCompare(b.name));
  const finalLsps = annotateDuplicates(lsps).sort((a, b) => a.name.localeCompare(b.name));

  const allEntries = [
    ...mcpServers,
    ...finalCommands,
    ...finalPrompts,
    ...finalHooks,
    ...finalLsps,
  ];
  const summary = {
    totalPrimitives: allEntries.length,
    driftedCount: allEntries.filter((e) => e.hasDrift).length,
    totalEstimatedTokens: allEntries.reduce((sum, e) => sum + e.estimatedTokens, 0),
  };

  return {
    scannedAt: new Date().toISOString(),
    mcpServers,
    commands: finalCommands,
    prompts: finalPrompts,
    hooks: finalHooks,
    lsps: finalLsps,
    summary,
  };
}

async function readHead(filePath: string, maxBytes = 8192): Promise<string> {
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
}

function stripPromptTags(raw: string): string {
  return raw
    .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, " ")
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, " ")
    .replace(/<\/?USER_REQUEST>/gi, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextSnippet(rawContent: unknown): string | undefined {
  if (typeof rawContent === "string") {
    const cleaned = stripPromptTags(rawContent);
    return cleaned ? cleaned.slice(0, 96) : undefined;
  }
  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>)["text"];
        if (typeof text === "string" && text.trim()) {
          const cleaned = stripPromptTags(text);
          if (cleaned) return cleaned.slice(0, 96);
        }
      }
    }
  }
  return undefined;
}

export async function scanSessions(homeOverride?: string, limit = 250): Promise<SessionSummary[]> {
  const home = homeOverride ?? os.homedir();
  const roots: Array<{ dir: string; harness: HarnessId; depth: number }> = [
    ...discoverClaudeConfigDirs(home).map((d) => ({
      dir: path.join(d, "projects"),
      harness: "claude" as HarnessId,
      depth: 2,
    })),
    { dir: path.join(home, ".codex", "sessions"), harness: "codex", depth: 4 },
    { dir: path.join(home, ".gemini", "antigravity", "brain"), harness: "antigravity", depth: 3 },
  ];

  const allFiles: Array<{ file: string; mtimeMs: number; harness: HarnessId }> = [];
  for (const r of roots) {
    const found = await collectFilesRecursive(r.dir, r.depth, ".jsonl");
    for (const item of found) {
      // Skip duplicate full-log mirror in Antigravity
      if (path.basename(item.file) === "transcript_full.jsonl") continue;
      allFiles.push({ ...item, harness: r.harness });
    }
  }

  allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const topFiles = allFiles.slice(0, limit);

  const sessions: SessionSummary[] = [];
  for (const item of topFiles) {
    const head = await readHead(item.file, 65536);
    const lines = head.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let title: string | undefined;
    let projectFolder: string | undefined;
    let model: string | undefined;
    let sessionId: string | undefined;

    for (const line of lines.slice(0, 40)) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (!sessionId && typeof obj["sessionId"] === "string") {
        sessionId = obj["sessionId"];
      }
      if (!projectFolder && typeof obj["cwd"] === "string") {
        projectFolder = obj["cwd"];
      }
      if (!model && typeof obj["model"] === "string") {
        model = obj["model"];
      }

      const payload = obj["payload"] as Record<string, unknown> | undefined;
      if (payload && typeof payload === "object") {
        if (!sessionId && typeof payload["id"] === "string") sessionId = payload["id"];
        if (!projectFolder && typeof payload["cwd"] === "string") projectFolder = payload["cwd"];
        if (!model && typeof payload["model"] === "string") model = payload["model"];
        if (!title) {
          if (payload["type"] === "user_message" && typeof payload["message"] === "string") {
            title = extractTextSnippet(payload["message"]);
          } else if (payload["role"] === "user") {
            title = extractTextSnippet(payload["content"]);
          }
        }
      }

      const msg = obj["message"] as Record<string, unknown> | undefined;
      if (!model && msg && typeof msg["model"] === "string") {
        model = msg["model"];
      }
      if (!title) {
        const role = obj["role"] ?? obj["type"] ?? msg?.["role"];
        if (role === "user" || role === "USER_INPUT") {
          title = extractTextSnippet(obj["content"]) ?? extractTextSnippet(msg?.["content"]);
        }
      }

      if (title && projectFolder && model && sessionId) break;
    }

    const baseId = path.basename(item.file, ".jsonl");
    if (!sessionId) {
      if (item.harness === "antigravity" && baseId === "transcript") {
        // .../<uuid>/.system_generated/logs/transcript.jsonl
        sessionId = path.basename(path.dirname(path.dirname(path.dirname(item.file))));
      } else {
        sessionId = baseId;
      }
    }

    const parentName = path.basename(path.dirname(item.file));
    if (!projectFolder && item.harness === "claude" && parentName.startsWith("-")) {
      projectFolder = parentName.replace(/-/g, "/");
    }

    sessions.push({
      id: sessionId,
      harnessId: item.harness,
      title: title ?? (projectFolder ? path.basename(projectFolder) : sessionId),
      ...(projectFolder ? { projectFolder } : {}),
      updatedAt: new Date(item.mtimeMs).toISOString(),
      messageCount: lines.length,
      ...(model ? { model } : {}),
      transcriptPath: item.file,
    });
  }

  return sessions;
}

function extractFullText(rawContent: unknown): string {
  if (typeof rawContent === "string") return rawContent.trim();
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((b) =>
        b && typeof b === "object" && typeof (b as Record<string, unknown>)["text"] === "string"
          ? String((b as Record<string, unknown>)["text"])
          : "",
      )
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return "";
}

export async function getSessionDetail(
  transcriptPath: string,
  harnessId: HarnessId,
): Promise<SessionDetail> {
  const st = await fs.stat(transcriptPath).catch(() => null);
  const raw = await fs.readFile(transcriptPath, "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let sessionId: string | undefined;
  let projectFolder: string | undefined;
  let model: string | undefined;
  let title: string | undefined;
  let promptCount = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const messages: SessionMessage[] = [];

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!sessionId && typeof obj["sessionId"] === "string") sessionId = obj["sessionId"];
    if (!projectFolder && typeof obj["cwd"] === "string") projectFolder = obj["cwd"];

    const payload = obj["payload"] as Record<string, unknown> | undefined;
    if (payload && typeof payload === "object") {
      if (!sessionId && typeof payload["id"] === "string") sessionId = payload["id"];
      if (!projectFolder && typeof payload["cwd"] === "string") projectFolder = payload["cwd"];
      if (typeof payload["model"] === "string") model = payload["model"];
    }

    const msg = obj["message"] as Record<string, unknown> | undefined;
    const msgModel =
      (typeof msg?.["model"] === "string" ? msg["model"] : undefined) ??
      (typeof obj["model"] === "string" ? obj["model"] : undefined);
    if (msgModel) model = msgModel;

    const usage = (msg?.["usage"] ?? obj["usage"]) as Record<string, unknown> | undefined;
    const inTok = Number(usage?.["input_tokens"] ?? obj["input_tokens"] ?? 0);
    const outTok = Number(usage?.["output_tokens"] ?? obj["output_tokens"] ?? 0);
    const cacheTok = Number(
      usage?.["cache_read_input_tokens"] ??
        usage?.["cached_input_tokens"] ??
        obj["cache_read_tokens"] ??
        0,
    );
    const stepTokens = inTok + outTok + cacheTok;
    if (stepTokens > 0) {
      totalTokens += stepTokens;
      totalCost += estimateCostUsd(msgModel ?? model ?? "sonnet", inTok, outTok, cacheTok);
    }

    const timestamp =
      (typeof obj["timestamp"] === "string" ? obj["timestamp"] : undefined) ??
      (typeof obj["created_at"] === "string" ? obj["created_at"] : undefined);

    const roleRaw = obj["role"] ?? obj["type"] ?? msg?.["role"] ?? payload?.["role"];
    let role: "user" | "assistant" | "system" | null = null;
    let text = "";

    if (roleRaw === "user" || roleRaw === "USER_INPUT") {
      role = "user";
      text = stripPromptTags(extractFullText(obj["content"]) || extractFullText(msg?.["content"]));
    } else if (payload?.["type"] === "user_message" && typeof payload["message"] === "string") {
      role = "user";
      text = stripPromptTags(payload["message"]);
    } else if (roleRaw === "assistant" || roleRaw === "PLANNER_RESPONSE") {
      role = "assistant";
      text = extractFullText(obj["content"]) || extractFullText(msg?.["content"]);
    }

    if (role && text) {
      if (role === "user") {
        promptCount += 1;
        if (!title) title = text.slice(0, 96);
      }
      messages.push({
        role,
        ...(timestamp ? { timestamp } : {}),
        ...(msgModel ? { model: msgModel } : {}),
        ...(stepTokens > 0 ? { tokens: stepTokens } : {}),
        content: text.slice(0, 4000),
      });
    }
  }

  const baseId = path.basename(transcriptPath, ".jsonl");
  if (!sessionId) {
    sessionId =
      harnessId === "antigravity" && baseId === "transcript"
        ? path.basename(path.dirname(path.dirname(path.dirname(transcriptPath))))
        : baseId;
  }

  return {
    id: sessionId,
    harnessId,
    title: title ?? (projectFolder ? path.basename(projectFolder) : sessionId),
    ...(projectFolder ? { projectFolder } : {}),
    transcriptPath,
    updatedAt: st ? new Date(st.mtimeMs).toISOString() : new Date().toISOString(),
    ...(model ? { model } : {}),
    promptCount,
    totalTokens,
    estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
    messages: messages.slice(-120),
  };
}

function estimateCostUsd(model: string, input: number, output: number, cacheRead: number): number {
  const m = model.toLowerCase();
  const inRate = m.includes("opus") ? 15 / 1e6 : m.includes("haiku") ? 0.8 / 1e6 : 3 / 1e6;
  const outRate = m.includes("opus") ? 75 / 1e6 : m.includes("haiku") ? 4 / 1e6 : 15 / 1e6;
  const cacheRate = inRate * 0.1;
  return input * inRate + output * outRate + cacheRead * cacheRate;
}

export async function scanUsageMetrics(homeOverride?: string): Promise<UsageDashboardSnapshot> {
  const home = homeOverride ?? os.homedir();
  const roots: Array<{ dir: string; harness: HarnessId; depth: number }> = [
    ...discoverClaudeConfigDirs(home).map((d) => ({
      dir: path.join(d, "projects"),
      harness: "claude" as HarnessId,
      depth: 2,
    })),
    { dir: path.join(home, ".codex", "sessions"), harness: "codex", depth: 4 },
  ];

  const allFiles: Array<{ file: string; mtimeMs: number; harness: HarnessId }> = [];
  for (const r of roots) {
    const found = await collectFilesRecursive(r.dir, r.depth, ".jsonl");
    for (const item of found) {
      allFiles.push({ ...item, harness: r.harness });
    }
  }

  allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const recentFiles = allFiles.slice(0, 60);

  const byModelMap = new Map<
    string,
    {
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      estimatedCostUsd: number;
    }
  >();
  const hourlyMap = new Map<string, { tokens: number; requests: number }>();
  for (let h = 0; h < 24; h++) {
    hourlyMap.set(`${String(h).padStart(2, "0")}:00`, { tokens: 0, requests: 0 });
  }

  const recentRequests: UsageRequestLog[] = [];
  let totalRequests = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCost = 0;

  for (const item of recentFiles) {
    let raw: string;
    try {
      raw = await fs.readFile(item.file, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      if (!line.includes("usage")) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const msg = obj["message"] as Record<string, unknown> | undefined;
      const usage = (msg?.["usage"] ?? obj["usage"]) as Record<string, unknown> | undefined;
      if (!usage || typeof usage !== "object") continue;

      const inputTokens = Number(usage["input_tokens"] ?? 0);
      const outputTokens = Number(usage["output_tokens"] ?? 0);
      const cacheReadTokens = Number(
        usage["cache_read_input_tokens"] ?? usage["cached_input_tokens"] ?? 0,
      );
      if (inputTokens + outputTokens + cacheReadTokens === 0) continue;

      const model =
        (typeof msg?.["model"] === "string" ? msg["model"] : undefined) ??
        (typeof obj["model"] === "string" ? obj["model"] : undefined) ??
        `${item.harness}-default`;

      const timestamp =
        typeof obj["timestamp"] === "string"
          ? obj["timestamp"]
          : new Date(item.mtimeMs).toISOString();
      const cost = estimateCostUsd(model, inputTokens, outputTokens, cacheReadTokens);

      totalRequests += 1;
      totalInput += inputTokens;
      totalOutput += outputTokens;
      totalCacheRead += cacheReadTokens;
      totalCost += cost;

      const m = byModelMap.get(model) ?? {
        model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        estimatedCostUsd: 0,
      };
      m.requests += 1;
      m.inputTokens += inputTokens;
      m.outputTokens += outputTokens;
      m.cacheReadTokens += cacheReadTokens;
      m.estimatedCostUsd += cost;
      byModelMap.set(model, m);

      const dt = new Date(timestamp);
      if (!Number.isNaN(dt.getTime())) {
        const hourKey = `${String(dt.getHours()).padStart(2, "0")}:00`;
        const hb = hourlyMap.get(hourKey);
        if (hb) {
          hb.tokens += inputTokens + outputTokens + cacheReadTokens;
          hb.requests += 1;
        }
      }

      if (recentRequests.length < 100) {
        recentRequests.push({
          timestamp,
          harnessId: item.harness,
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          estimatedCostUsd: cost,
        });
      }
    }
  }

  const totalTokensProcessed = totalInput + totalOutput + totalCacheRead;
  const cacheHitRatePct =
    totalInput + totalCacheRead > 0
      ? Math.round((totalCacheRead / (totalInput + totalCacheRead)) * 1000) / 10
      : 0;

  const hourly: UsageHourlyBucket[] = Array.from(hourlyMap.entries()).map(([hour, v]) => ({
    hour,
    tokens: v.tokens,
    requests: v.requests,
  }));

  const byModel: UsageModelBreakdown[] = Array.from(byModelMap.values()).sort(
    (a, b) => b.estimatedCostUsd - a.estimatedCostUsd,
  );

  recentRequests.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return {
    scannedAt: new Date().toISOString(),
    totalRequests,
    totalTokensProcessed,
    cacheHitRatePct,
    estimatedCostUsd: Math.round(totalCost * 100) / 100,
    hourly,
    byModel,
    recentRequests: recentRequests.slice(0, 60),
  };
}
