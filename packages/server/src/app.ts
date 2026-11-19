import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  ActionService,
  buildCleanupCandidates,
  computeGlobalTelemetry,
  ConfigStore,
  executeCleanupQueue,
  FsSkillScanner,
  getSessionDetail,
  GitInspector,
  InventoryService,
  NativeCliAdapter,
  parseSkillMd,
  previewCleanupQueue,
  resolveHarnesses,
  scanPrimitives,
  scanSessions,
  scanUsageMetrics,
  ShellExecutor,
  SourceCatalogAdapter,
  SourceCatalogService,
  TiktokenCounter,
  UsageLogInspector,
  type ConfigPort,
  type HarnessDefinition,
  type InventorySnapshot,
  type SourceCatalogGroup,
} from "@harness-control/core";

export interface ServerDeps {
  readonly inventoryService?: InventoryService;
  readonly actionService?: ActionService;
  readonly sourceCatalogService?: SourceCatalogService;
  readonly configStore?: ConfigPort;
}

const execFileAsync = promisify(execFile);

const installSchema = z.object({
  source: z.string().min(1),
  skillName: z.string().min(1),
  manager: z.enum(["npx-skills", "apm"]),
  scope: z.enum(["global", "project"]),
  projectPath: z.string().optional(),
});

const removeSchema = z
  .object({
    skillId: z.string().min(1).optional(),
    scope: z.enum(["skill", "author"]).optional(),
    author: z.string().min(1).optional(),
    targetScope: z.enum(["all", "global", "project", "selected-projects"]).optional(),
    projectPaths: z.array(z.string().min(1)).optional(),
    exposurePath: z.string().optional(),
    confirmUnmanaged: z.boolean().optional(),
  })
  .refine(
    (v) => Boolean(v.skillId) || (v.scope === "author" && Boolean(v.author)),
    "Either skillId or scope='author' with author is required.",
  );

const upgradeSchema = z.object({
  scope: z.enum(["all", "author", "skill"]),
  author: z.string().optional(),
  skillId: z.string().optional(),
});

const migrateSchema = z.object({
  skillIds: z.array(z.string().min(1)).min(1),
  apmManifestPath: z.string().optional(),
  cleanupLegacyLockfiles: z.boolean().optional(),
});

const repairSchema = z.object({
  brokenPath: z.string().min(1),
  newTargetPath: z.string().min(1),
});

const cleanupQueueSchema = z.object({
  items: z.array(
    z.object({
      skillId: z.string().min(1),
      category: z.enum(["duplicates", "drift", "unused", "untracked", "broken", "outdated"]),
      action: z.enum(["remove", "migrate-to-apm", "upgrade", "skip"]),
      targetScope: z.enum(["all", "global", "project", "selected-projects"]).optional(),
      projectPaths: z.array(z.string().min(1)).optional(),
    }),
  ),
});

export function createServerApp(deps: ServerDeps = {}): Hono {
  const app = new Hono();
  app.use("/api/*", cors());

  const configStore = deps.configStore ?? new ConfigStore();
  const inventoryService =
    deps.inventoryService ??
    new InventoryService(
      new FsSkillScanner(),
      new NativeCliAdapter(),
      new TiktokenCounter(),
      new GitInspector(),
      new UsageLogInspector(),
    );
  const actionService = deps.actionService ?? new ActionService(new ShellExecutor());
  const sourceCatalogService =
    deps.sourceCatalogService ?? new SourceCatalogService(new SourceCatalogAdapter());

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let cachedSnapshot: InventorySnapshot | null = null;
  let cachedHarnesses: readonly HarnessDefinition[] = [];
  let cachedSources: readonly SourceCatalogGroup[] = [];

  async function ensureSnapshot(refresh = false): Promise<{
    snapshot: InventorySnapshot;
    harnesses: readonly HarnessDefinition[];
    sources: readonly SourceCatalogGroup[];
  }> {
    if (!cachedSnapshot || refresh) {
      const cfg = await configStore.loadConfig();
      cachedHarnesses = resolveHarnesses(cfg.customHarnesses);
      cachedSnapshot = await inventoryService.scan(cachedHarnesses, cfg);
      cachedSources = await sourceCatalogService.buildCatalog(
        cachedSnapshot.skills,
        cfg.checkRemoteUpdates,
      );
    }
    return { snapshot: cachedSnapshot, harnesses: cachedHarnesses, sources: cachedSources };
  }

  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      version: "0.1.0",
      pid: process.pid,
      host: "127.0.0.1",
      port: Number(process.env["HARNESS_CONTROL_PORT"] ?? 4318),
      startedAt,
      uptimeSeconds: Math.floor((Date.now() - startedMs) / 1000),
      lastScanAt: cachedSnapshot?.scannedAt ?? null,
      cachedSkillsCount: cachedSnapshot?.skills.length ?? 0,
      harnessesCount: cachedHarnesses.length,
    }),
  );

  app.get("/api/inventory", async (c) => {
    const refresh = c.req.query("refresh") === "true";
    const { snapshot, harnesses, sources } = await ensureSnapshot(refresh);
    const telemetry = computeGlobalTelemetry(snapshot.skills);
    return c.json({ snapshot, telemetry, harnesses, sources });
  });

  app.post("/api/inventory/scan", async (c) => {
    const { snapshot, harnesses, sources } = await ensureSnapshot(true);
    const telemetry = computeGlobalTelemetry(snapshot.skills);
    return c.json({ snapshot, telemetry, harnesses, sources });
  });

  app.get("/api/sources", async (c) => {
    const refresh = c.req.query("refresh") === "true";
    const { sources } = await ensureSnapshot(refresh);
    return c.json(sources);
  });

  app.get("/api/skills/content", async (c) => {
    const skillId = c.req.query("skillId");
    if (!skillId) {
      return c.json({ error: "Missing skillId" }, 400);
    }
    const { snapshot } = await ensureSnapshot(false);
    const skill = snapshot.skills.find((s) => s.id === skillId);
    if (!skill) {
      return c.json({ error: "Skill not found" }, 404);
    }
    const exposure = skill.exposures.find((e) => e.linkType !== "symlink-broken");
    if (!exposure) {
      return c.json({ error: "No readable SKILL.md exposure found" }, 404);
    }
    try {
      const rawContent = await fs.readFile(exposure.skillFilePath, "utf8");
      const parsed = parseSkillMd(rawContent, skill.name);
      const ghMatch = skill.provenance.sourceRepo?.match(
        /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/,
      );
      const skillsShUrl = ghMatch?.[1]
        ? `https://skills.sh/${ghMatch[1]}/${encodeURIComponent(skill.name)}`
        : `https://skills.sh/?q=${encodeURIComponent(skill.name)}`;
      return c.json({
        skillId: skill.id,
        skillFilePath: exposure.skillFilePath,
        rawContent,
        frontmatterRaw: parsed.frontmatterRaw,
        bodyRaw: parsed.bodyRaw,
        skillsShUrl,
      });
    } catch {
      return c.json({ error: "Failed to read SKILL.md" }, 500);
    }
  });

  app.get("/api/telemetry", async (c) => {
    const { snapshot } = await ensureSnapshot(false);
    return c.json(computeGlobalTelemetry(snapshot.skills));
  });

  app.get("/api/config", async (c) => {
    const cfg = await configStore.loadConfig();
    return c.json(cfg);
  });

  app.put("/api/config", async (c) => {
    const body = await c.req.json();
    await configStore.saveConfig(body);
    cachedSnapshot = null;
    return c.json({ saved: true });
  });

  app.get("/api/discover", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const mode = c.req.query("mode") === "trending" ? "trending" : "search";
    const searchQuery = q.length >= 2 ? q : "agent";

    const { snapshot } = await ensureSnapshot(false);
    const installedNames = new Set(snapshot.skills.map((s) => s.name.toLowerCase()));

    try {
      const url = `https://skills.sh/api/search?q=${encodeURIComponent(searchQuery)}&limit=36`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "harness-control" },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          skills?: Array<{
            id: string;
            source: string;
            skillId: string;
            name: string;
            installs?: number;
          }>;
        };
        const raw = json.skills ?? [];
        const sorted =
          mode === "trending"
            ? [...raw].sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0))
            : raw;
        return c.json({
          query: q,
          mode,
          provider: "skills.sh",
          skills: sorted.map((item) => ({
            id: item.id,
            source: item.source,
            skillId: item.skillId,
            name: item.name,
            installs: item.installs ?? 0,
            skillsShUrl: `https://skills.sh/${item.source}/${encodeURIComponent(item.skillId)}`,
            isInstalled: installedNames.has(item.name.toLowerCase()),
          })),
        });
      }
    } catch {
      // Fallback to npx skills find below
    }

    // Fallback: invoke npx --no-install skills find
    try {
      const { stdout } = await execFileAsync(
        "npx",
        ["--no-install", "skills", "find", searchQuery],
        { timeout: 8000 },
      );
      const parsed: Array<{
        id: string;
        source: string;
        skillId: string;
        name: string;
        installs: number;
        skillsShUrl: string;
        isInstalled: boolean;
      }> = [];
      const lines = stdout.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^([^/\s]+\/[^@\s]+)@([^\s]+)\s+([\d.]+[KM]?)\s+installs/i);
        if (m?.[1] && m[2]) {
          parsed.push({
            id: `${m[1]}/${m[2]}`,
            source: m[1],
            skillId: m[2],
            name: m[2],
            installs: 0,
            skillsShUrl: `https://skills.sh/${m[1]}/${encodeURIComponent(m[2])}`,
            isInstalled: installedNames.has(m[2].toLowerCase()),
          });
        }
      }
      return c.json({ query: q, mode, provider: "npx-skills", skills: parsed });
    } catch {
      return c.json({ query: q, mode, provider: "offline", skills: [] });
    }
  });

  app.post("/api/actions/install/preview", async (c) => {
    const parsed = installSchema.parse(await c.req.json());
    const preview = actionService.previewInstall({
      source: parsed.source,
      skillName: parsed.skillName,
      manager: parsed.manager,
      scope: parsed.scope,
      ...(parsed.projectPath ? { projectPath: parsed.projectPath } : {}),
    });
    return c.json(preview);
  });

  app.post("/api/actions/install/execute", async (c) => {
    const parsed = installSchema.parse(await c.req.json());
    const result = await actionService.executeInstall({
      source: parsed.source,
      skillName: parsed.skillName,
      manager: parsed.manager,
      scope: parsed.scope,
      ...(parsed.projectPath ? { projectPath: parsed.projectPath } : {}),
    });
    if (result.success) cachedSnapshot = null;
    return c.json(result);
  });

  app.post("/api/actions/remove/preview", async (c) => {
    const parsed = removeSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const preview = actionService.previewRemove(snapshot.skills, {
      ...(parsed.skillId ? { skillId: parsed.skillId } : {}),
      ...(parsed.scope ? { scope: parsed.scope } : {}),
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.targetScope ? { targetScope: parsed.targetScope } : {}),
      ...(parsed.projectPaths ? { projectPaths: parsed.projectPaths } : {}),
      ...(parsed.exposurePath ? { exposurePath: parsed.exposurePath } : {}),
      ...(parsed.confirmUnmanaged !== undefined
        ? { confirmUnmanaged: parsed.confirmUnmanaged }
        : {}),
    });
    return c.json(preview);
  });

  app.post("/api/actions/remove/execute", async (c) => {
    const parsed = removeSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const result = await actionService.executeRemove(snapshot.skills, {
      ...(parsed.skillId ? { skillId: parsed.skillId } : {}),
      ...(parsed.scope ? { scope: parsed.scope } : {}),
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.targetScope ? { targetScope: parsed.targetScope } : {}),
      ...(parsed.projectPaths ? { projectPaths: parsed.projectPaths } : {}),
      ...(parsed.exposurePath ? { exposurePath: parsed.exposurePath } : {}),
      ...(parsed.confirmUnmanaged !== undefined
        ? { confirmUnmanaged: parsed.confirmUnmanaged }
        : {}),
    });
    if (result.success) cachedSnapshot = null;
    return c.json(result);
  });

  app.post("/api/actions/upgrade/preview", async (c) => {
    const parsed = upgradeSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const preview = actionService.previewUpgrade(snapshot.skills, {
      scope: parsed.scope,
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.skillId ? { skillId: parsed.skillId } : {}),
    });
    return c.json(preview);
  });

  app.post("/api/actions/upgrade/execute", async (c) => {
    const parsed = upgradeSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const result = await actionService.executeUpgrade(snapshot.skills, {
      scope: parsed.scope,
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.skillId ? { skillId: parsed.skillId } : {}),
    });
    if (result.success) cachedSnapshot = null;
    return c.json(result);
  });

  app.post("/api/actions/migrate-to-apm/preview", async (c) => {
    const parsed = migrateSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const preview = actionService.previewMigrateToApm(snapshot.skills, {
      skillIds: parsed.skillIds,
      ...(parsed.apmManifestPath ? { apmManifestPath: parsed.apmManifestPath } : {}),
      ...(parsed.cleanupLegacyLockfiles !== undefined
        ? { cleanupLegacyLockfiles: parsed.cleanupLegacyLockfiles }
        : {}),
    });
    return c.json(preview);
  });

  app.post("/api/actions/migrate-to-apm/execute", async (c) => {
    const parsed = migrateSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const result = await actionService.executeMigrateToApm(snapshot.skills, {
      skillIds: parsed.skillIds,
      ...(parsed.apmManifestPath ? { apmManifestPath: parsed.apmManifestPath } : {}),
      ...(parsed.cleanupLegacyLockfiles !== undefined
        ? { cleanupLegacyLockfiles: parsed.cleanupLegacyLockfiles }
        : {}),
    });
    if (result.success) cachedSnapshot = null;
    return c.json(result);
  });

  app.post("/api/actions/repair-link/preview", async (c) => {
    const parsed = repairSchema.parse(await c.req.json());
    return c.json(actionService.previewRepairLink(parsed));
  });

  app.post("/api/actions/repair-link/execute", async (c) => {
    const parsed = repairSchema.parse(await c.req.json());
    const result = await actionService.executeRepairLink(parsed);
    if (result.success) cachedSnapshot = null;
    return c.json(result);
  });

  app.get("/api/cleanup/plan", async (c) => {
    const refresh = c.req.query("refresh") === "true";
    const { snapshot } = await ensureSnapshot(refresh);
    const candidates = buildCleanupCandidates(snapshot.skills);
    return c.json({ candidates, totalSkills: snapshot.skills.length });
  });

  app.post("/api/cleanup/preview", async (c) => {
    const parsed = cleanupQueueSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const items = parsed.items.map((item) => ({
      skillId: item.skillId,
      category: item.category,
      action: item.action,
      ...(item.targetScope ? { targetScope: item.targetScope } : {}),
      ...(item.projectPaths ? { projectPaths: item.projectPaths } : {}),
    }));
    return c.json(previewCleanupQueue(actionService, snapshot.skills, items));
  });

  app.post("/api/cleanup/execute", async (c) => {
    const parsed = cleanupQueueSchema.parse(await c.req.json());
    const { snapshot } = await ensureSnapshot(false);
    const items = parsed.items.map((item) => ({
      skillId: item.skillId,
      category: item.category,
      action: item.action,
      ...(item.targetScope ? { targetScope: item.targetScope } : {}),
      ...(item.projectPaths ? { projectPaths: item.projectPaths } : {}),
    }));
    const result = await executeCleanupQueue(actionService, snapshot.skills, items);
    if (result.success) cachedSnapshot = null;
    return c.json(result);
  });

  app.get("/api/primitives", async (c) => {
    const primitives = await scanPrimitives();
    return c.json(primitives);
  });

  const primitiveActionSchema = z.object({
    action: z.enum(["upgrade", "migrate-to-apm", "remove"]),
    kind: z.enum(["mcp", "hook", "command", "lsp", "prompt"]),
    name: z.string().min(1),
    harnessId: z.string().optional(),
    owningManager: z.string().optional(),
    scope: z.enum(["global", "project", "mixed"]).optional(),
    path: z.string().optional(),
    source: z.string().optional(),
  });

  app.post("/api/primitives/action/preview", async (c) => {
    const parsed = primitiveActionSchema.parse(await c.req.json());
    return c.json(
      actionService.previewPrimitiveAction({
        action: parsed.action,
        kind: parsed.kind,
        name: parsed.name,
        ...(parsed.harnessId ? { harnessId: parsed.harnessId } : {}),
        ...(parsed.owningManager ? { owningManager: parsed.owningManager } : {}),
        ...(parsed.scope ? { scope: parsed.scope } : {}),
        ...(parsed.path ? { path: parsed.path } : {}),
        ...(parsed.source ? { source: parsed.source } : {}),
      }),
    );
  });

  app.post("/api/primitives/action/execute", async (c) => {
    const parsed = primitiveActionSchema.parse(await c.req.json());
    return c.json(
      await actionService.executePrimitiveAction({
        action: parsed.action,
        kind: parsed.kind,
        name: parsed.name,
        ...(parsed.harnessId ? { harnessId: parsed.harnessId } : {}),
        ...(parsed.owningManager ? { owningManager: parsed.owningManager } : {}),
        ...(parsed.scope ? { scope: parsed.scope } : {}),
        ...(parsed.path ? { path: parsed.path } : {}),
        ...(parsed.source ? { source: parsed.source } : {}),
      }),
    );
  });

  app.get("/api/sessions", async (c) => {
    const sessions = await scanSessions();
    return c.json({ sessions, total: sessions.length });
  });

  app.get("/api/sessions/detail", async (c) => {
    const transcriptPath = c.req.query("path");
    const harnessId = c.req.query("harnessId") || "claude";
    if (!transcriptPath) return c.json({ error: "path query parameter is required" }, 400);
    const detail = await getSessionDetail(transcriptPath, harnessId);
    return c.json(detail);
  });

  app.post("/api/system/reveal", async (c) => {
    const body = z.object({ path: z.string().min(1) }).parse(await c.req.json());
    await fs.stat(body.path);
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-R", body.path]);
    } else if (process.platform === "win32") {
      await execFileAsync("explorer", [`/select,${body.path}`]);
    } else {
      await execFileAsync("xdg-open", [path.dirname(body.path)]);
    }
    return c.json({ ok: true });
  });

  app.get("/api/usage-metrics", async (c) => {
    const metrics = await scanUsageMetrics();
    return c.json(metrics);
  });

  return app;
}
