import type {
  ActionResult,
  CleanupActionChoice,
  CleanupCandidate,
  CleanupPreviewResponse,
  CleanupQueueItem,
  DryRunPreview,
  RemoveTargetScope,
  SkillRecord,
} from "@harness-control/core";
import type { DaemonClient, DaemonStatus, InventoryResponse } from "@harness-control/server";
import {
  render,
  useCallback,
  useEffect,
  useKeymap,
  useMemo,
  useState,
  useTerminalSize,
} from "@termuijs/jsx";

type ModuleId = "overview" | "skills" | "tokens" | "projects" | "sources" | "daemon" | "cleanup";
type FilterMode = "all" | "broken" | "drift" | "updates";
type SortMode = "name" | "desc" | "full" | "projects";

const MODULES: readonly { id: ModuleId; key: string; label: string }[] = [
  { id: "overview", key: "1", label: "Overview" },
  { id: "skills", key: "2", label: "Skills" },
  { id: "tokens", key: "3", label: "Tokens" },
  { id: "projects", key: "4", label: "Projects" },
  { id: "sources", key: "5", label: "Sources" },
  { id: "daemon", key: "6", label: "Daemon" },
  { id: "cleanup", key: "7", label: "Cleanup" },
];

const SORT_CYCLE: readonly SortMode[] = ["name", "desc", "full", "projects"];

interface TuiProps {
  readonly client: DaemonClient;
  readonly initialData?: InventoryResponse;
  readonly initialStatus?: DaemonStatus | null;
}

function PreviewModal({
  preview,
  onConfirm,
  onCancel,
}: {
  readonly preview: DryRunPreview;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  useKeymap([
    { key: "y", action: onConfirm },
    { key: "return", action: onConfirm },
    { key: "n", action: onCancel },
    { key: "escape", action: onCancel },
  ]);

  return (
    <box border="round" borderColor="yellow" padding={1} flexDirection="column" width="100%">
      <text bold color="yellow">
        DRY-RUN PREVIEW: {preview.summary}
      </text>
      {preview.commands.length > 0 && (
        <box flexDirection="column">
          <text bold>Commands:</text>
          {preview.commands.map((c, i) => (
            <text key={i} color="cyan">
              $ {c.command} {c.args.join(" ")} {c.cwd ? `(cwd: ${c.cwd})` : ""}
            </text>
          ))}
        </box>
      )}
      {preview.pathChanges.length > 0 && (
        <box flexDirection="column">
          <text bold>Path changes:</text>
          {preview.pathChanges.map((p, i) => (
            <text key={i} color="magenta">
              [{p.operation}] {p.path} {p.target ? `-> ${p.target}` : ""}
            </text>
          ))}
        </box>
      )}
      {preview.warnings.length > 0 && (
        <box flexDirection="column">
          {preview.warnings.map((w, i) => (
            <text key={i} color="red">
              ! {w}
            </text>
          ))}
        </box>
      )}
      <text dim>Press [y/Enter] to execute or [n/Esc] to cancel</text>
    </box>
  );
}

function HarnessManagerTui({ client, initialData, initialStatus }: TuiProps) {
  const [data, setData] = useState<InventoryResponse | null>(initialData ?? null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(initialStatus ?? null);
  const [cleanupCandidates, setCleanupCandidates] = useState<readonly CleanupCandidate[]>([]);
  const [cleanupIdx, setCleanupIdx] = useState(0);
  const [cleanupDecisions, setCleanupDecisions] = useState<
    Record<
      string,
      { selected: boolean; action: CleanupActionChoice; targetScope: RemoveTargetScope }
    >
  >({});
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleId>("overview");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pendingPreview, setPendingPreview] = useState<{
    preview: DryRunPreview;
    execute: () => Promise<ActionResult>;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      try {
        setError(null);
        const [res, status] = await Promise.all([client.getInventory(refresh), client.getStatus()]);
        setData(res);
        setDaemonStatus(status);
      } catch (err) {
        setDaemonStatus(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  useEffect(() => {
    if (!initialData) {
      void load(false);
    }
    const timer = setInterval(() => {
      void client.getStatus().then(setDaemonStatus);
    }, 5000);
    return () => clearInterval(timer);
  }, [client, initialData, load]);

  const skills: readonly SkillRecord[] = useMemo(() => {
    const raw = data?.snapshot.skills ?? [];
    const filtered = raw.filter((s) => {
      if (filterMode === "broken") return s.hasBrokenLinks;
      if (filterMode === "drift") return s.hasDrift;
      if (filterMode === "updates") return s.provenance.updateStatus.updateAvailable;
      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (sortMode) {
        case "desc":
          return b.tokens.descriptionTokens - a.tokens.descriptionTokens;
        case "full":
          return b.tokens.fullTokens - a.tokens.fullTokens;
        case "projects":
          return b.projectCount - a.projectCount;
        case "name":
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [data, filterMode, sortMode]);

  const size = useTerminalSize();
  const termRows = size.rows > 0 ? size.rows : process.stdout.rows || 24;
  const pageSize = Math.max(6, termRows - 14);
  const clampedIdx = Math.min(selectedIdx, Math.max(skills.length - 1, 0));
  const selectedSkill = skills[clampedIdx];
  const windowStart = Math.max(
    0,
    Math.min(clampedIdx - Math.floor(pageSize / 2), Math.max(0, skills.length - pageSize)),
  );
  const visibleSkills = skills.slice(windowStart, windowStart + pageSize);

  useEffect(() => {
    if (!data) return;
    void client
      .getCleanupPlan(false)
      .then((plan) => {
        setCleanupCandidates(plan.candidates);
        setCleanupDecisions((prev) => {
          const next: typeof prev = {};
          for (const c of plan.candidates) {
            const k = `${c.category}:${c.skillId}`;
            next[k] = prev[k] ?? {
              selected: c.category === "duplicates" && c.recommendedAction !== "skip",
              action: c.recommendedAction,
              targetScope: c.recommendedScope,
            };
          }
          return next;
        });
      })
      .catch(() => undefined);
  }, [data, client]);

  const cleanupQueue: readonly CleanupQueueItem[] = useMemo(() => {
    const items: CleanupQueueItem[] = [];
    for (const c of cleanupCandidates) {
      const dec = cleanupDecisions[`${c.category}:${c.skillId}`];
      if (!dec || !dec.selected || dec.action === "skip") continue;
      items.push({
        skillId: c.skillId,
        category: c.category,
        action: dec.action,
        ...(dec.action === "remove" ? { targetScope: dec.targetScope } : {}),
      });
    }
    return items;
  }, [cleanupCandidates, cleanupDecisions]);

  useEffect(() => {
    if (activeModule !== "cleanup") return;
    void client
      .previewCleanup(cleanupQueue)
      .then(setCleanupPreview)
      .catch(() => undefined);
  }, [activeModule, cleanupQueue, client]);

  const cycleModule = (delta: number) => {
    setActiveModule((cur) => {
      const idx = MODULES.findIndex((m) => m.id === cur);
      const next = (idx + delta + MODULES.length) % MODULES.length;
      return MODULES[next]?.id ?? "overview";
    });
  };

  useKeymap(
    pendingPreview
      ? []
      : [
          { key: "q", action: () => process.exit(0) },
          { key: "c", ctrl: true, action: () => process.exit(0) },
          { key: "1", action: () => setActiveModule("overview") },
          { key: "2", action: () => setActiveModule("skills") },
          { key: "3", action: () => setActiveModule("tokens") },
          { key: "4", action: () => setActiveModule("projects") },
          { key: "5", action: () => setActiveModule("sources") },
          { key: "6", action: () => setActiveModule("daemon") },
          { key: "7", action: () => setActiveModule("cleanup") },
          { key: "tab", action: () => cycleModule(1) },
          { key: "right", action: () => cycleModule(1) },
          { key: "left", action: () => cycleModule(-1) },
          {
            key: "r",
            action: () => {
              setStatusMessage("Rescanning harnesses & workspaces...");
              void load(true).then(() => setStatusMessage("Scan complete."));
            },
          },
          {
            key: "b",
            action: () => {
              setFilterMode((m) => (m === "broken" ? "all" : "broken"));
              setSelectedIdx(0);
            },
          },
          {
            key: "d",
            action: () => {
              setFilterMode((m) => (m === "drift" ? "all" : "drift"));
              setSelectedIdx(0);
            },
          },
          {
            key: "u",
            action: () => {
              setFilterMode((m) => (m === "updates" ? "all" : "updates"));
              setSelectedIdx(0);
            },
          },
          {
            key: "c",
            action: () => {
              setFilterMode("all");
              setSelectedIdx(0);
            },
          },
          {
            key: "s",
            action: () => {
              if (activeModule === "cleanup") {
                const c = cleanupCandidates[cleanupIdx];
                if (!c) return;
                const k = `${c.category}:${c.skillId}`;
                const scopes: RemoveTargetScope[] = ["all", "global", "project"];
                setCleanupDecisions((prev) => {
                  const cur = prev[k] ?? {
                    selected: false,
                    action: c.recommendedAction,
                    targetScope: c.recommendedScope,
                  };
                  const nextScope =
                    scopes[(scopes.indexOf(cur.targetScope) + 1) % scopes.length] ?? "all";
                  return { ...prev, [k]: { ...cur, targetScope: nextScope } };
                });
                return;
              }
              setSortMode((cur) => {
                const next =
                  SORT_CYCLE[(SORT_CYCLE.indexOf(cur) + 1) % SORT_CYCLE.length] ?? "name";
                setStatusMessage(`Sort: ${next}`);
                return next;
              });
            },
          },
          {
            key: "a",
            action: () => {
              if (activeModule !== "cleanup") return;
              const c = cleanupCandidates[cleanupIdx];
              if (!c) return;
              const k = `${c.category}:${c.skillId}`;
              const actions: CleanupActionChoice[] = [
                "remove",
                "migrate-to-apm",
                "upgrade",
                "skip",
              ];
              setCleanupDecisions((prev) => {
                const cur = prev[k] ?? {
                  selected: false,
                  action: c.recommendedAction,
                  targetScope: c.recommendedScope,
                };
                const nextAction =
                  actions[(actions.indexOf(cur.action) + 1) % actions.length] ?? "skip";
                return {
                  ...prev,
                  [k]: { ...cur, action: nextAction, selected: nextAction !== "skip" },
                };
              });
            },
          },
          {
            key: "space",
            action: () => {
              if (activeModule !== "cleanup") return;
              const c = cleanupCandidates[cleanupIdx];
              if (!c) return;
              const k = `${c.category}:${c.skillId}`;
              setCleanupDecisions((prev) => {
                const cur = prev[k] ?? {
                  selected: false,
                  action: c.recommendedAction,
                  targetScope: c.recommendedScope,
                };
                return { ...prev, [k]: { ...cur, selected: !cur.selected } };
              });
            },
          },
          {
            key: "j",
            action: () => {
              if (activeModule === "cleanup") {
                setCleanupIdx((i) => Math.min(Math.max(cleanupCandidates.length - 1, 0), i + 1));
              } else {
                setSelectedIdx((i) => Math.min(Math.max(skills.length - 1, 0), i + 1));
              }
            },
          },
          {
            key: "down",
            action: () => {
              if (activeModule === "cleanup") {
                setCleanupIdx((i) => Math.min(Math.max(cleanupCandidates.length - 1, 0), i + 1));
              } else {
                setSelectedIdx((i) => Math.min(Math.max(skills.length - 1, 0), i + 1));
              }
            },
          },
          {
            key: "k",
            action: () => {
              if (activeModule === "cleanup") {
                setCleanupIdx((i) => Math.max(0, i - 1));
              } else {
                setSelectedIdx((i) => Math.max(0, i - 1));
              }
            },
          },
          {
            key: "up",
            action: () => {
              if (activeModule === "cleanup") {
                setCleanupIdx((i) => Math.max(0, i - 1));
              } else {
                setSelectedIdx((i) => Math.max(0, i - 1));
              }
            },
          },
          {
            key: "x",
            action: () => {
              if (activeModule === "cleanup") {
                if (cleanupQueue.length === 0) return;
                void client.previewCleanup(cleanupQueue).then((res) => {
                  setPendingPreview({
                    preview: {
                      action: "remove",
                      summary: res.summary,
                      targetSkillIds: cleanupQueue.map((q) => q.skillId),
                      commands: res.commands,
                      pathChanges: res.pathChanges,
                      warnings: res.warnings,
                    },
                    execute: async () => {
                      const execRes = await client.executeCleanup(cleanupQueue);
                      return {
                        action: "remove",
                        success: execRes.success,
                        preview: {
                          action: "remove",
                          summary: execRes.preview.summary,
                          targetSkillIds: cleanupQueue.map((q) => q.skillId),
                          commands: execRes.preview.commands,
                          pathChanges: execRes.preview.pathChanges,
                          warnings: execRes.preview.warnings,
                        },
                        executedCommands: execRes.executedCommands,
                        errors: execRes.errors,
                      };
                    },
                  });
                });
                return;
              }
              if (!selectedSkill || activeModule !== "skills") return;
              void client.previewRemove({ skillId: selectedSkill.id }).then((preview) => {
                setPendingPreview({
                  preview,
                  execute: () => client.executeRemove({ skillId: selectedSkill.id }),
                });
              });
            },
          },
          {
            key: "U",
            action: () => {
              if (!selectedSkill || activeModule !== "skills") return;
              void client
                .previewUpgrade({ scope: "skill", skillId: selectedSkill.id })
                .then((preview) => {
                  setPendingPreview({
                    preview,
                    execute: () =>
                      client.executeUpgrade({ scope: "skill", skillId: selectedSkill.id }),
                  });
                });
            },
          },
          {
            key: "m",
            action: () => {
              if (!selectedSkill || activeModule !== "skills") return;
              void client
                .previewMigrateToApm({ skillIds: [selectedSkill.id], cleanupLegacyLockfiles: true })
                .then((preview) => {
                  setPendingPreview({
                    preview,
                    execute: () =>
                      client.executeMigrateToApm({
                        skillIds: [selectedSkill.id],
                        cleanupLegacyLockfiles: true,
                      }),
                  });
                });
            },
          },
        ],
  );

  if (error) {
    return (
      <box padding={1} width="100%" height="100%" flexDirection="column" gap={1}>
        <card title="Daemon Error" borderColor="red" width="100%" height={6}>
          <text color="red">{error}</text>
          <text dim>Press [r] to retry or [q] to quit.</text>
        </card>
      </box>
    );
  }

  if (!data) {
    return (
      <box padding={1} width="100%" height="100%" flexDirection="column" gap={1}>
        <spinner preset="dots" label="Connecting to harness-controld..." color="cyan" />
        <skeleton variant="shimmer" height={4} width="100%" />
      </box>
    );
  }

  const brokenCount = data.snapshot.skills.filter((s) => s.hasBrokenLinks).length;
  const driftCount = data.snapshot.skills.filter((s) => s.hasDrift).length;
  const maxHarnessDesc = Math.max(
    1,
    ...data.telemetry.byHarness.map((h) => h.tokens.descriptionTokens),
  );
  const maxAuthorFull = Math.max(1, ...data.telemetry.byAuthor.map((a) => a.tokens.fullTokens));
  const activeLabel = MODULES.find((m) => m.id === activeModule)?.label ?? "Overview";

  const daemonBadge = daemonStatus
    ? `DAEMON ONLINE :${daemonStatus.port} (pid ${daemonStatus.pid}, up ${daemonStatus.uptimeSeconds}s)`
    : "DAEMON OFFLINE";

  return (
    <col padding={0} gap={0} width="100%" height="100%">
      {/* Top Status Header */}
      <box border="round" borderColor="cyan" height={3} width="100%" flexDirection="column">
        <text bold color={daemonStatus ? "cyan" : "red"}>
          {` harness-control › ${activeLabel.padEnd(14)} | ${daemonBadge}`}
        </text>
      </box>

      {/* Main Split: Sidebar + Active Module */}
      <row flexGrow={1} width="100%" gap={1}>
        {/* Left Navigable Module Sidebar */}
        <box
          border="round"
          borderColor="brightBlack"
          width={24}
          height="100%"
          flexDirection="column"
        >
          <text bold color="cyan">
            {" "}
            MODULES
          </text>
          {MODULES.map((m) => {
            const isActive = activeModule === m.id;
            return (
              <text key={m.id} color={isActive ? "cyan" : "white"} bold={isActive}>
                {isActive ? " ▸ " : "   "}[{m.key}] {m.label}
              </text>
            );
          })}
          <divider />
          <text bold dim>
            {" "}
            PRIMITIVES
          </text>
          <text color="green"> ● Skills (active)</text>
          <text dim> ○ MCPs (soon)</text>
          <text dim> ○ Hooks (soon)</text>
          <text dim> ○ Commands (soon)</text>
          <text dim> ○ LSPs (soon)</text>
          <divider />
          <text bold dim>
            {" "}
            HEALTH
          </text>
          <text color={brokenCount > 0 ? "red" : "green"}> Broken links: {brokenCount}</text>
          <text color={driftCount > 0 ? "yellow" : "green"}> Project drift: {driftCount}</text>
        </box>

        {/* Right Active Module Panel */}
        <box flexGrow={1} height="100%" flexDirection="column" gap={1}>
          {statusMessage && (
            <box height={1} width="100%">
              <text color="green"> ✓ {statusMessage}</text>
            </box>
          )}

          {activeModule === "overview" && (
            <box flexDirection="column" flexGrow={1} width="100%" gap={1}>
              <row gap={1} height={5} width="100%">
                <box
                  border="round"
                  borderColor="cyan"
                  flexGrow={1}
                  height={5}
                  flexDirection="column"
                >
                  <text bold color="cyan">
                    {" "}
                    Unique Skills
                  </text>
                  <text bold> {data.telemetry.totalUniqueSkills}</text>
                  <text dim> {data.snapshot.harnessesScanned.length} harnesses</text>
                </box>
                <box
                  border="round"
                  borderColor="blue"
                  flexGrow={1}
                  height={5}
                  flexDirection="column"
                >
                  <text bold color="blue">
                    {" "}
                    Always-On Desc
                  </text>
                  <text bold>
                    {" "}
                    {data.telemetry.totalTokens.descriptionTokens.toLocaleString()}t
                  </text>
                  <text dim> prompt overhead</text>
                </box>
                <box
                  border="round"
                  borderColor="magenta"
                  flexGrow={1}
                  height={5}
                  flexDirection="column"
                >
                  <text bold color="magenta">
                    {" "}
                    Full SKILL.md
                  </text>
                  <text bold> {data.telemetry.totalTokens.fullTokens.toLocaleString()}t</text>
                  <text dim> on-demand cost</text>
                </box>
                <box
                  border="round"
                  borderColor={brokenCount + driftCount > 0 ? "yellow" : "green"}
                  flexGrow={1}
                  height={5}
                  flexDirection="column"
                >
                  <text bold color={brokenCount + driftCount > 0 ? "yellow" : "green"}>
                    {" "}
                    Health Alerts
                  </text>
                  <text bold> {brokenCount + driftCount}</text>
                  <text dim>
                    {" "}
                    {brokenCount} broken · {driftCount} drift
                  </text>
                </box>
              </row>

              <row gap={1} flexGrow={1} width="100%">
                <box
                  border="round"
                  borderColor="cyan"
                  flexGrow={1}
                  height="100%"
                  flexDirection="column"
                >
                  <text bold color="cyan">
                    {" "}
                    Top Harnesses (Desc Tokens)
                  </text>
                  {data.telemetry.byHarness.slice(0, 6).map((h) => {
                    const ratio = Math.min(
                      1,
                      Math.max(0, h.tokens.descriptionTokens / maxHarnessDesc),
                    );
                    return (
                      <box key={h.harnessId} flexDirection="column" height={2} width="100%">
                        <text>
                          {` ${h.harnessId.padEnd(14)} ${String(h.tokens.descriptionTokens).padStart(6)}t (${h.skillCount})`}
                        </text>
                        <progressbar
                          value={ratio}
                          fillColor="cyan"
                          showLabel={false}
                          width="100%"
                          height={1}
                        />
                      </box>
                    );
                  })}
                </box>

                <box
                  border="round"
                  borderColor="blue"
                  flexGrow={1}
                  height="100%"
                  flexDirection="column"
                >
                  <text bold color="blue">
                    {" "}
                    Top Sources (Full Tokens)
                  </text>
                  {data.telemetry.byAuthor.slice(0, 6).map((a) => {
                    const ratio = Math.min(1, Math.max(0, a.tokens.fullTokens / maxAuthorFull));
                    return (
                      <box key={a.author} flexDirection="column" height={2} width="100%">
                        <text>
                          {` ${a.author.slice(0, 16).padEnd(17)} ${String(a.tokens.fullTokens).padStart(7)}t (${a.skillCount})`}
                        </text>
                        <progressbar
                          value={ratio}
                          fillColor="blue"
                          showLabel={false}
                          width="100%"
                          height={1}
                        />
                      </box>
                    );
                  })}
                </box>
              </row>

              <box
                border="round"
                borderColor="green"
                height={5}
                width="100%"
                flexDirection="column"
              >
                <text bold color="green">
                  {" "}
                  Core Daemon & Modules
                </text>
                <text color="green">
                  {` Status: ${daemonStatus ? `ONLINE on http://${daemonStatus.host}:${daemonStatus.port} | PID: ${daemonStatus.pid} | Last scan: ${daemonStatus.lastScanAt ?? "pending"}` : "OFFLINE"}`}
                </text>
                <text dim>
                  {" "}
                  Navigate: [2] Skills [3] Tokens [4] Projects [5] Sources [6] Daemon | [Tab] Next
                </text>
              </box>
            </box>
          )}

          {activeModule === "skills" && (
            <box flexDirection="column" flexGrow={1} width="100%" gap={1}>
              <box
                border="round"
                borderColor="cyan"
                flexGrow={1}
                width="100%"
                flexDirection="column"
              >
                <text bold color="cyan">
                  {` Skills Inventory (${skills.length}) — Filter: ${filterMode} | Sort: ${sortMode}`}
                </text>
                {visibleSkills.length === 0 ? (
                  <text color="yellow"> No skills match '{filterMode}'. Press [c] to clear.</text>
                ) : (
                  visibleSkills.map((s, idx) => {
                    const abs = windowStart + idx;
                    const active = abs === clampedIdx;
                    const harnesses = Array.from(new Set(s.exposures.map((e) => e.harnessId))).join(
                      ",",
                    );
                    return (
                      <text key={s.id} color={active ? "cyan" : "white"} bold={active}>
                        {active ? " ▸ " : "   "}
                        {s.name.slice(0, 23).padEnd(24)}{" "}
                        {s.provenance.author.slice(0, 14).padEnd(15)}{" "}
                        {s.provenance.owningManager.padEnd(13)}{" "}
                        {String(s.tokens.descriptionTokens).padStart(4)}t [{harnesses.slice(0, 16)}]
                        {s.hasBrokenLinks ? " [BROKEN]" : ""}
                        {s.hasDrift ? " [DRIFT]" : ""}
                      </text>
                    );
                  })
                )}
              </box>

              {selectedSkill && (
                <box
                  border="round"
                  borderColor="brightBlack"
                  height={6}
                  width="100%"
                  flexDirection="column"
                >
                  <text bold color="white">
                    {` Inspector [${clampedIdx + 1}/${skills.length}] ${selectedSkill.name}`}
                  </text>
                  <text dim>{` ${selectedSkill.description || "No description"}`}</text>
                  <text>
                    {` Tokens: desc=${selectedSkill.tokens.descriptionTokens} | fm=${selectedSkill.tokens.frontmatterTokens} | body=${selectedSkill.tokens.bodyTokens} | full=${selectedSkill.tokens.fullTokens} | projects=${selectedSkill.projectCount}`}
                  </text>
                  <text color="cyan"> Actions: [x] Remove [U] Upgrade [m] Migrate to APM</text>
                </box>
              )}
            </box>
          )}

          {activeModule === "tokens" && (
            <row gap={1} flexGrow={1} width="100%">
              <box
                border="round"
                borderColor="cyan"
                flexGrow={1}
                height="100%"
                flexDirection="column"
              >
                <text bold color="cyan">
                  {" "}
                  By Harness (Desc Tokens)
                </text>
                {data.telemetry.byHarness.slice(0, 12).map((h) => (
                  <text key={h.harnessId}>
                    {` ${h.harnessId.padEnd(16)} ${String(h.skillCount).padStart(3)}sk desc:${String(h.tokens.descriptionTokens).padStart(6)}t full:${String(h.tokens.fullTokens).padStart(7)}t`}
                  </text>
                ))}
              </box>
              <box
                border="round"
                borderColor="blue"
                flexGrow={1}
                height="100%"
                flexDirection="column"
              >
                <text bold color="blue">
                  {" "}
                  By Source
                </text>
                {data.telemetry.byAuthor.slice(0, 12).map((a) => (
                  <text key={a.author}>
                    {` ${a.author.slice(0, 18).padEnd(19)} ${String(a.skillCount).padStart(3)}sk desc:${String(a.tokens.descriptionTokens).padStart(6)}t full:${String(a.tokens.fullTokens).padStart(7)}t`}
                  </text>
                ))}
              </box>
            </row>
          )}

          {activeModule === "projects" && (
            <box
              border="round"
              borderColor="yellow"
              flexGrow={1}
              width="100%"
              flexDirection="column"
            >
              <text bold color="yellow">
                {" "}
                Cross-Project Aggregation & Drift
              </text>
              {skills
                .filter((s) => s.projectCount > 0)
                .slice(0, 16)
                .map((s) => (
                  <text key={s.id} color={s.hasDrift ? "yellow" : "green"}>
                    {` ${s.name.slice(0, 24).padEnd(25)} (${s.projectCount} proj)${s.hasDrift ? " [DRIFT]" : " [SYNC] "} ${s.projectPaths[0] ?? ""}`}
                  </text>
                ))}
            </box>
          )}

          {activeModule === "sources" && (
            <box
              border="round"
              borderColor="magenta"
              flexGrow={1}
              width="100%"
              flexDirection="column"
            >
              <text bold color="magenta">
                {" "}
                Source Catalogs (Installed / Available / Deprecated)
              </text>
              {data.sources.slice(0, 14).map((src) => (
                <text key={src.sourceId} color="white">
                  {` ${(src.marketplaceName ?? src.sourceRepo ?? src.author).slice(0, 32).padEnd(33)} [${src.owningManager.padEnd(13)}] inst:${String(src.installedCount).padStart(2)} avail:${String(src.availableCount).padStart(2)} depr:${String(src.deprecatedCount).padStart(2)}`}
                </text>
              ))}
            </box>
          )}

          {activeModule === "daemon" && (
            <box
              border="round"
              borderColor={daemonStatus ? "green" : "red"}
              flexGrow={1}
              width="100%"
              flexDirection="column"
            >
              <text bold color={daemonStatus ? "green" : "red"}>
                {` Core Daemon Status — ${daemonStatus ? "ONLINE" : "OFFLINE"}`}
              </text>
              {daemonStatus && (
                <box flexDirection="column">
                  <text>{` Endpoint:    http://${daemonStatus.host}:${daemonStatus.port}`}</text>
                  <text>{` PID:         ${daemonStatus.pid}`}</text>
                  <text>{` Version:     ${daemonStatus.version}`}</text>
                  <text>{` Uptime:      ${daemonStatus.uptimeSeconds}s`}</text>
                  <text>{` Started At:  ${daemonStatus.startedAt}`}</text>
                  <text>{` Last Scan:   ${daemonStatus.lastScanAt ?? "n/a"}`}</text>
                  <text>
                    {` Cached:      ${daemonStatus.cachedSkillsCount} skills across ${daemonStatus.harnessesCount} harnesses`}
                  </text>
                </box>
              )}
              <divider />
              <text dim> Press [r] to trigger a fresh scan via the daemon.</text>
            </box>
          )}

          {activeModule === "cleanup" && (
            <box
              border="rounded"
              borderColor="cyan"
              flexGrow={1}
              width="100%"
              flexDirection="column"
              padding={1}
            >
              <text bold color="cyan">
                {` Cleanup Planner — ${cleanupCandidates.length} candidates`}
              </text>
              {cleanupPreview && (
                <text color="green">
                  {` Queue: ${cleanupPreview.impact.removeCount} rm · ${cleanupPreview.impact.migrateCount} apm · -${cleanupPreview.impact.tokensSavedDesc} desc (-${cleanupPreview.impact.tokensSavedDescPct}%) · -${cleanupPreview.impact.tokensSavedFull} full (-${cleanupPreview.impact.tokensSavedFullPct}%)`}
                </text>
              )}
              <divider />
              {cleanupCandidates.length === 0 ? (
                <text dim> No cleanup issues detected.</text>
              ) : (
                cleanupCandidates
                  .slice(
                    Math.max(
                      0,
                      Math.min(cleanupIdx - 4, Math.max(0, cleanupCandidates.length - pageSize)),
                    ),
                    Math.max(
                      0,
                      Math.min(cleanupIdx - 4, Math.max(0, cleanupCandidates.length - pageSize)),
                    ) + pageSize,
                  )
                  .map((c, idx) => {
                    const start = Math.max(
                      0,
                      Math.min(cleanupIdx - 4, Math.max(0, cleanupCandidates.length - pageSize)),
                    );
                    const isActive = start + idx === cleanupIdx;
                    const dec = cleanupDecisions[`${c.category}:${c.skillId}`];
                    const mark = dec?.selected ? "[x]" : "[ ]";
                    const act = dec?.action ?? c.recommendedAction;
                    const scope =
                      act === "remove" ? `(${dec?.targetScope ?? c.recommendedScope})` : "";
                    return (
                      <text
                        key={`${c.category}:${c.skillId}`}
                        bold={isActive}
                        color={isActive ? "cyan" : dec?.selected ? "yellow" : "white"}
                      >
                        {`${isActive ? ">" : " "} ${mark} [${c.category.padEnd(10)}] ${c.skillName.slice(0, 22).padEnd(22)} ${act.padEnd(14)} ${scope.padEnd(9)} -${c.descriptionTokens}t`}
                      </text>
                    );
                  })
              )}
            </box>
          )}

          {pendingPreview && (
            <PreviewModal
              preview={pendingPreview.preview}
              onCancel={() => setPendingPreview(null)}
              onConfirm={() => {
                const run = pendingPreview.execute;
                setPendingPreview(null);
                setStatusMessage("Executing...");
                void run().then((res) => {
                  setStatusMessage(
                    res.success ? "Action succeeded." : `Failed: ${res.errors.join("; ")}`,
                  );
                  void load(true);
                });
              }}
            />
          )}
        </box>
      </row>

      {/* Bottom Shortcut Bar */}
      <box height={1} width="100%">
        <text dim>
          {" "}
          [1-7/Tab] Switch Module [r] Rescan [q] Quit
          {activeModule === "skills"
            ? "  |  [j/k] Navigate  [b/d/u/c] Filter  [s] Sort  [x/U/m] Actions"
            : activeModule === "cleanup"
              ? "  |  [j/k] Navigate  [space] Toggle  [a] Action  [s] Scope  [x] Execute"
              : ""}
        </text>
      </box>
    </col>
  );
}

export async function launchTui(client: DaemonClient): Promise<void> {
  const [initialData, initialStatus] = await Promise.all([
    client.getInventory(false).catch(() => undefined),
    client.getStatus().catch(() => null),
  ]);
  await render(
    <HarnessManagerTui
      client={client}
      {...(initialData ? { initialData } : {})}
      initialStatus={initialStatus}
    />,
    { title: "harness-control" },
  );
}
