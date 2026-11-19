import type {
  ActionResult,
  CleanupActionChoice,
  CleanupCandidate,
  CleanupCategory,
  CleanupExecuteResponse,
  CleanupPreviewResponse,
  CleanupQueueItem,
  DryRunPreview,
  HarnessId,
  PrimitiveKind,
  PrimitivesSnapshot,
  RemoveTargetScope,
  SessionDetail,
  SessionSummary,
  SkillRecord,
  UsageDashboardSnapshot,
} from "@harness-control/core";
import type {
  DaemonStatus,
  DiscoverResponse,
  DiscoverSkillEntry,
  InventoryResponse,
  SkillContentResponse,
} from "@harness-control/server";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpCircle,
  ArrowUpDown,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Flame,
  FolderGit2,
  FolderOpen,
  GitCompare,
  Globe,
  History,
  Home,
  Layers,
  LayoutGrid,
  Link2,
  Link2Off,
  List as ListIcon,
  Moon,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HarnessIcon } from "./HarnessIcon.js";
import { MarkdownViewer } from "./MarkdownViewer.js";
import { SourceIcon } from "./SourceIcon.js";

type ViewId =
  | "home"
  | "inventory"
  | "cleanup"
  | "discover"
  | "tokens"
  | "projects"
  | "sources"
  | "sessions"
  | "primitives";
type SortColumn = "name" | "author" | "manager" | "descTokens" | "fullTokens" | "projects";
type SortDirection = "ascending" | "descending";
type HealthFilter = "all" | "broken" | "drift" | "duplicates" | "unused" | "updates";
type ThemeMode = "dark" | "light";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function resolveDaemonBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const isTauri =
    window.location.protocol === "tauri:" ||
    window.location.hostname === "tauri.localhost" ||
    window.location.protocol === "file:";
  return isTauri ? "http://127.0.0.1:4318" : "";
}

const API_BASE = resolveDaemonBaseUrl();

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

const client = {
  getStatus: () => apiGet<DaemonStatus>("/api/health"),
  getInventory: (refresh = false) =>
    apiGet<InventoryResponse>(`/api/inventory${refresh ? "?refresh=true" : ""}`),
  getDiscover: (q: string, mode: "trending" | "search") =>
    apiGet<DiscoverResponse>(`/api/discover?q=${encodeURIComponent(q)}&mode=${mode}`),
  getSkillContent: (skillId: string) =>
    apiGet<SkillContentResponse>(`/api/skills/content?skillId=${encodeURIComponent(skillId)}`),
  previewInstall: (req: unknown) => apiPost<DryRunPreview>("/api/actions/install/preview", req),
  executeInstall: (req: unknown) => apiPost<ActionResult>("/api/actions/install/execute", req),
  previewRemove: (req: unknown) => apiPost<DryRunPreview>("/api/actions/remove/preview", req),
  executeRemove: (req: unknown) => apiPost<ActionResult>("/api/actions/remove/execute", req),
  previewUpgrade: (req: unknown) => apiPost<DryRunPreview>("/api/actions/upgrade/preview", req),
  executeUpgrade: (req: unknown) => apiPost<ActionResult>("/api/actions/upgrade/execute", req),
  previewMigrateToApm: (req: unknown) =>
    apiPost<DryRunPreview>("/api/actions/migrate-to-apm/preview", req),
  executeMigrateToApm: (req: unknown) =>
    apiPost<ActionResult>("/api/actions/migrate-to-apm/execute", req),
  getCleanupPlan: (refresh = false) =>
    apiGet<{ candidates: readonly CleanupCandidate[]; totalSkills: number }>(
      `/api/cleanup/plan${refresh ? "?refresh=true" : ""}`,
    ),
  previewCleanup: (items: readonly CleanupQueueItem[]) =>
    apiPost<CleanupPreviewResponse>("/api/cleanup/preview", { items }),
  executeCleanup: (items: readonly CleanupQueueItem[]) =>
    apiPost<CleanupExecuteResponse>("/api/cleanup/execute", { items }),
  getPrimitives: () => apiGet<PrimitivesSnapshot>("/api/primitives"),
  getSessions: () =>
    apiGet<{ sessions: readonly SessionSummary[]; total: number }>("/api/sessions"),
  getSessionDetail: (transcriptPath: string, harnessId: string) =>
    apiGet<SessionDetail>(
      `/api/sessions/detail?path=${encodeURIComponent(transcriptPath)}&harnessId=${encodeURIComponent(harnessId)}`,
    ),
  revealPath: (targetPath: string) =>
    apiPost<{ ok: boolean }>("/api/system/reveal", { path: targetPath }),
  getUsageMetrics: () => apiGet<UsageDashboardSnapshot>("/api/usage-metrics"),
};

const PRIMITIVE_NAV: readonly { id: PrimitiveKind; label: string; enabled: boolean }[] = [
  { id: "skill", label: "Skills", enabled: true },
  { id: "mcp", label: "MCP Servers", enabled: true },
  { id: "hook", label: "Hooks", enabled: true },
  { id: "command", label: "Commands", enabled: true },
  { id: "lsp", label: "LSPs", enabled: true },
  { id: "prompt", label: "Prompts", enabled: true },
];

const VIEW_TITLES: Record<ViewId, string> = {
  home: "Home",
  inventory: "Library",
  cleanup: "Cleanup",
  discover: "Discover",
  tokens: "Token Usage",
  projects: "Projects & Drift",
  sources: "Sources & Catalog",
  sessions: "Sessions",
  primitives: "Primitives",
};

function SortIcon({ direction }: { readonly direction?: SortDirection | undefined }) {
  if (direction === "ascending") return <ArrowUp size={12} aria-hidden="true" />;
  if (direction === "descending") return <ArrowDown size={12} aria-hidden="true" />;
  return <ArrowUpDown size={12} opacity={0.4} aria-hidden="true" />;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString();
}

function LinkTypeIcon({
  linkType,
  size = 11,
}: {
  readonly linkType: "symlink-healthy" | "symlink-broken" | "physical-copy";
  readonly size?: number;
}) {
  if (linkType === "symlink-broken") {
    return <Link2Off size={size} aria-hidden="true" />;
  }
  if (linkType === "physical-copy") {
    return <Copy size={size} aria-hidden="true" />;
  }
  return <Link2 size={size} aria-hidden="true" />;
}

function CopyableText({
  text,
  maxWidth = 320,
}: {
  readonly text: string;
  readonly maxWidth?: number | string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <span
        className="mono"
        title={text}
        style={{
          color: "var(--muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth,
        }}
      >
        {text}
      </span>
      <button
        type="button"
        className="icon-ghost-btn"
        aria-label={`Copy ${text}`}
        title={`Copy: ${text}`}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? <Check size={10} aria-hidden="true" /> : <Copy size={10} aria-hidden="true" />}
      </button>
    </span>
  );
}

const VIEW_ICONS: Record<ViewId, typeof Layers> = {
  home: Home,
  inventory: Layers,
  cleanup: Sparkles,
  discover: Compass,
  tokens: Cpu,
  projects: FolderGit2,
  sources: Package,
  sessions: History,
  primitives: Boxes,
};

export function App() {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("home");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [search, setSearch] = useState("");
  const [harnessSearch, setHarnessSearch] = useState("");
  const [collapsedSidebarSections, setCollapsedSidebarSections] = useState<
    Set<"views" | "primitives" | "harnesses">
  >(() => new Set());
  const [harnessFilter, setHarnessFilter] = useState<HarnessId | "all">("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [tokensSearch, setTokensSearch] = useState("");
  const [projectsSearch, setProjectsSearch] = useState("");
  const [projectsDriftFilter, setProjectsDriftFilter] = useState<"all" | "drifted" | "sync">("all");
  const [sourcesSearch, setSourcesSearch] = useState("");
  const [sourcesFilter, setSourcesFilter] = useState<"all" | "available" | "deprecated">("all");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(() => new Set());
  const [sortCol, setSortCol] = useState<SortColumn>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("ascending");
  const [layoutMode, setLayoutMode] = useState<"list" | "cards">("list");
  const [groupBy, setGroupBy] = useState<"none" | "source" | "manager" | "harness">("none");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"overview" | "markdown">("overview");
  const [skillContent, setSkillContent] = useState<SkillContentResponse | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [previewModal, setPreviewModal] = useState<{
    preview: DryRunPreview;
    execute: () => Promise<ActionResult>;
    removeContext?: {
      scope: "skill" | "author";
      skillId?: string;
      author?: string;
      availableProjects: readonly string[];
      hasGlobal: boolean;
      targetScope: "all" | "global" | "project" | "selected-projects";
      selectedProjects: readonly string[];
    };
  } | null>(null);
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverMode, setDiscoverMode] = useState<"trending" | "search">("trending");
  const [discoverData, setDiscoverData] = useState<DiscoverResponse | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [installTarget, setInstallTarget] = useState<DiscoverSkillEntry | null>(null);
  const [installManager, setInstallManager] = useState<"npx-skills" | "apm">("npx-skills");
  const [installScope, setInstallScope] = useState<"global" | "project">("global");
  const [installProjectPath, setInstallProjectPath] = useState("");
  const [cleanupCandidates, setCleanupCandidates] = useState<readonly CleanupCandidate[]>([]);
  const [cleanupDecisions, setCleanupDecisions] = useState<
    Record<
      string,
      { selected: boolean; action: CleanupActionChoice; targetScope: RemoveTargetScope }
    >
  >({});
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreviewResponse | null>(null);
  const [collapsedCleanupCats, setCollapsedCleanupCats] = useState<Set<CleanupCategory>>(
    () => new Set(),
  );
  const [cleanupExecuting, setCleanupExecuting] = useState(false);
  const [primitivesData, setPrimitivesData] = useState<PrimitivesSnapshot | null>(null);
  const [primitiveTab, setPrimitiveTab] = useState<"mcp" | "command" | "prompt" | "hook" | "lsp">(
    "mcp",
  );
  const [sessionsData, setSessionsData] = useState<readonly SessionSummary[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionHarnessFilter, setSessionHarnessFilter] = useState<string>("all");
  const [sessionGroupBy, setSessionGroupBy] = useState<"time" | "project">("time");
  const [sessionSortBy, setSessionSortBy] = useState<"newest" | "oldest" | "title" | "messages">(
    "newest",
  );
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [usageMetricsData, setUsageMetricsData] = useState<UsageDashboardSnapshot | null>(null);
  const [tokensTab, setTokensTab] = useState<"budgets" | "requests">("budgets");
  const [installPreview, setInstallPreview] = useState<DryRunPreview | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const installDialogRef = useRef<HTMLDialogElement>(null);
  const skillDialogRef = useRef<HTMLDialogElement>(null);
  const searchId = useId();
  const discoverSearchId = useId();
  const installProjectId = useId();
  const managerSelectId = useId();
  const authorSelectId = useId();
  const groupBySelectId = useId();
  const invCaptionId = useId();

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  useEffect(() => {
    document.title = `${VIEW_TITLES[view]} | harness-control`;
  }, [view]);

  const load = useCallback(async (refresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const [res, status] = await Promise.all([
        client.getInventory(refresh),
        client.getStatus().catch(() => null),
      ]);
      setData(res);
      setDaemonStatus(status);
      if (refresh) {
        setLiveAnnouncement(`Rescan complete: ${res.snapshot.skills.length} skills discovered.`);
      }
    } catch (err) {
      setDaemonStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => {
      void client
        .getStatus()
        .then(setDaemonStatus)
        .catch(() => setDaemonStatus(null));
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (view === "primitives" && !primitivesData) {
      void client
        .getPrimitives()
        .then(setPrimitivesData)
        .catch(() => undefined);
    }
    if (view === "sessions" && sessionsData.length === 0) {
      void client
        .getSessions()
        .then((res) => setSessionsData(res.sessions))
        .catch(() => undefined);
    }
    if (view === "tokens" && !usageMetricsData) {
      void client
        .getUsageMetrics()
        .then(setUsageMetricsData)
        .catch(() => undefined);
    }
  }, [view, primitivesData, sessionsData.length, usageMetricsData]);

  const cleanupKey = (c: Pick<CleanupCandidate, "category" | "skillId">) =>
    `${c.category}:${c.skillId}`;

  const loadCleanupPlan = useCallback(async () => {
    try {
      const plan = await client.getCleanupPlan(false);
      setCleanupCandidates(plan.candidates);
      setCleanupDecisions((prev) => {
        const next: typeof prev = {};
        for (const c of plan.candidates) {
          const key = cleanupKey(c);
          next[key] = prev[key] ?? {
            selected: c.category === "duplicates" && c.recommendedAction !== "skip",
            action: c.recommendedAction,
            targetScope: c.recommendedScope,
          };
        }
        return next;
      });
    } catch {
      // Ignore transient load error
    }
  }, []);

  useEffect(() => {
    if (data) void loadCleanupPlan();
  }, [data, loadCleanupPlan]);

  const cleanupQueue: readonly CleanupQueueItem[] = useMemo(() => {
    const items: CleanupQueueItem[] = [];
    for (const c of cleanupCandidates) {
      const dec = cleanupDecisions[cleanupKey(c)];
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
    if (view !== "cleanup") return;
    let active = true;
    void client
      .previewCleanup(cleanupQueue)
      .then((res) => {
        if (active) setCleanupPreview(res);
      })
      .catch(() => {
        if (active) setCleanupPreview(null);
      });
    return () => {
      active = false;
    };
  }, [view, cleanupQueue]);

  useEffect(() => {
    if (!selectedSkillId) {
      setSkillContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    void client
      .getSkillContent(selectedSkillId)
      .then((res) => {
        if (!cancelled) setSkillContent(res);
      })
      .catch(() => {
        if (!cancelled) setSkillContent(null);
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSkillId]);

  const loadDiscover = useCallback(async (q: string, mode: "trending" | "search") => {
    setDiscoverLoading(true);
    try {
      const res = await client.getDiscover(q, mode);
      setDiscoverData(res);
    } catch {
      setDiscoverData(null);
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "discover" && !discoverData && !discoverLoading) {
      void loadDiscover(discoverQuery, discoverMode);
    }
  }, [discoverData, discoverLoading, discoverMode, discoverQuery, loadDiscover, view]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (previewModal && !dialog.open) {
      dialog.showModal();
    } else if (!previewModal && dialog.open) {
      dialog.close();
    }
  }, [previewModal]);

  useEffect(() => {
    const dialog = installDialogRef.current;
    if (!dialog) return;
    if (installTarget && !dialog.open) {
      dialog.showModal();
    } else if (!installTarget && dialog.open) {
      dialog.close();
    }
  }, [installTarget]);

  useEffect(() => {
    const dialog = skillDialogRef.current;
    if (!dialog) return;
    if (selectedSkillId && !dialog.open) {
      dialog.showModal();
    } else if (!selectedSkillId && dialog.open) {
      dialog.close();
    }
  }, [selectedSkillId]);

  useEffect(() => {
    if (!installTarget) {
      setInstallPreview(null);
      return;
    }
    let cancelled = false;
    void client
      .previewInstall({
        source: installTarget.source,
        skillName: installTarget.skillId,
        manager: installManager,
        scope: installScope,
        ...(installScope === "project" && installProjectPath
          ? { projectPath: installProjectPath }
          : {}),
      })
      .then((p) => {
        if (!cancelled) setInstallPreview(p);
      })
      .catch(() => {
        if (!cancelled) setInstallPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [installManager, installProjectPath, installScope, installTarget]);

  const toggleSort = (col: SortColumn) => {
    const nextDir: SortDirection =
      sortCol === col && sortDir === "ascending" ? "descending" : "ascending";
    setSortCol(col);
    setSortDir(nextDir);
    setLiveAnnouncement(`Sorted by ${col}, ${nextDir}`);
  };

  const harnessCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!data) return counts;
    for (const s of data.snapshot.skills) {
      const uniqueH = new Set(s.exposures.map((e) => e.harnessId));
      for (const h of uniqueH) {
        counts.set(h, (counts.get(h) ?? 0) + 1);
      }
    }
    return counts;
  }, [data]);

  const authorList = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.snapshot.skills.map((s) => s.provenance.author))).sort((a, b) =>
      collator.compare(a, b),
    );
  }, [data]);

  const filteredSkills: readonly SkillRecord[] = useMemo(() => {
    if (!data) return [];
    const list = data.snapshot.skills.filter((s) => {
      if (harnessFilter !== "all" && !s.exposures.some((e) => e.harnessId === harnessFilter)) {
        return false;
      }
      if (scopeFilter !== "all" && !s.exposures.some((e) => e.scope === scopeFilter)) {
        return false;
      }
      if (authorFilter !== "all" && s.provenance.author !== authorFilter) {
        return false;
      }
      if (managerFilter !== "all" && s.provenance.owningManager !== managerFilter) return false;
      if (healthFilter === "broken" && !s.hasBrokenLinks) return false;
      if (healthFilter === "drift" && !s.hasDrift) return false;
      if (healthFilter === "duplicates" && !s.duplicates) return false;
      if (healthFilter === "unused" && (s.usage?.activationCount ?? 0) > 0) return false;
      if (healthFilter === "updates" && !s.provenance.updateStatus.updateAvailable) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.provenance.author.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });

    const factor = sortDir === "ascending" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortCol) {
        case "name":
          return factor * collator.compare(a.name, b.name);
        case "author":
          return factor * collator.compare(a.provenance.author, b.provenance.author);
        case "manager":
          return factor * collator.compare(a.provenance.owningManager, b.provenance.owningManager);
        case "descTokens":
          return factor * (a.tokens.descriptionTokens - b.tokens.descriptionTokens);
        case "fullTokens":
          return factor * (a.tokens.fullTokens - b.tokens.fullTokens);
        case "projects":
          return factor * (a.projectCount - b.projectCount);
      }
    });
  }, [
    authorFilter,
    data,
    harnessFilter,
    healthFilter,
    managerFilter,
    scopeFilter,
    search,
    sortCol,
    sortDir,
  ]);

  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(filteredSkills.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedSkills = showAll
    ? filteredSkills
    : filteredSkills.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const groupedSkills = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, SkillRecord[]>();
    for (const s of filteredSkills) {
      let keys: string[];
      if (groupBy === "source") keys = [s.provenance.author || "unknown"];
      else if (groupBy === "manager") keys = [s.provenance.owningManager];
      else {
        const hs = Array.from(new Set(s.exposures.map((e) => e.harnessId)));
        keys = hs.length > 0 ? hs : ["unexposed"];
      }
      for (const k of keys) {
        const arr = map.get(k) ?? [];
        arr.push(s);
        map.set(k, arr);
      }
    }
    return Array.from(map.entries()).sort((a, b) => collator.compare(a[0], b[0]));
  }, [filteredSkills, groupBy]);

  const selectedSkill = useMemo(
    () => data?.snapshot.skills.find((s) => s.id === selectedSkillId) ?? null,
    [data, selectedSkillId],
  );

  const buildRemoveRequest = (ctx: {
    scope: "skill" | "author";
    skillId?: string;
    author?: string;
    targetScope: "all" | "global" | "project" | "selected-projects";
    selectedProjects: readonly string[];
  }) => ({
    scope: ctx.scope,
    ...(ctx.skillId ? { skillId: ctx.skillId } : {}),
    ...(ctx.author ? { author: ctx.author } : {}),
    targetScope: ctx.targetScope,
    ...(ctx.targetScope === "selected-projects" ? { projectPaths: ctx.selectedProjects } : {}),
  });

  const openRemovePreview = async (
    skill: SkillRecord,
    overrideScope?: "all" | "global" | "project",
  ) => {
    const hasGlobal = skill.exposures.some((e) => e.scope === "global");
    const availableProjects = skill.projectPaths;
    const targetScope: "all" | "global" | "project" =
      overrideScope ??
      (hasGlobal && availableProjects.length > 0
        ? "all"
        : availableProjects.length > 0
          ? "project"
          : "global");
    const removeContext = {
      scope: "skill" as const,
      skillId: skill.id,
      availableProjects,
      hasGlobal,
      targetScope,
      selectedProjects: availableProjects,
    };
    const req = buildRemoveRequest(removeContext);
    const preview = await client.previewRemove(req);
    setPreviewModal({ preview, execute: () => client.executeRemove(req), removeContext });
  };

  const openRemoveExposurePreview = async (skill: SkillRecord, exposurePath: string) => {
    const exp = skill.exposures.find((e) => e.path === exposurePath);
    const hasGlobal = skill.exposures.some((e) => e.scope === "global");
    const availableProjects = skill.projectPaths;
    const targetScope: "all" | "global" | "project" | "selected-projects" =
      exp?.scope === "global" ? "global" : exp?.projectRoot ? "selected-projects" : "project";
    const selectedProjects = exp?.projectRoot ? [exp.projectRoot] : availableProjects;
    const removeContext = {
      scope: "skill" as const,
      skillId: skill.id,
      availableProjects,
      hasGlobal,
      targetScope,
      selectedProjects,
    };
    const req = { skillId: skill.id, exposurePath };
    const preview = await client.previewRemove(req);
    setPreviewModal({ preview, execute: () => client.executeRemove(req), removeContext });
  };

  const openRemoveSourcePreview = async (author: string) => {
    const matching =
      data?.snapshot.skills.filter(
        (s) => s.provenance.author.toLowerCase() === author.toLowerCase(),
      ) ?? [];
    const hasGlobal = matching.some((s) => s.exposures.some((e) => e.scope === "global"));
    const availableProjects = Array.from(new Set(matching.flatMap((s) => s.projectPaths))).sort();
    const targetScope: "all" | "global" | "project" =
      hasGlobal && availableProjects.length > 0
        ? "all"
        : availableProjects.length > 0
          ? "project"
          : "global";
    const removeContext = {
      scope: "author" as const,
      author,
      availableProjects,
      hasGlobal,
      targetScope,
      selectedProjects: availableProjects,
    };
    const req = buildRemoveRequest(removeContext);
    const preview = await client.previewRemove(req);
    setPreviewModal({ preview, execute: () => client.executeRemove(req), removeContext });
  };

  const updateRemoveContext = async (
    nextCtx: NonNullable<NonNullable<typeof previewModal>["removeContext"]>,
  ) => {
    const req = buildRemoveRequest(nextCtx);
    const preview = await client.previewRemove(req);
    setPreviewModal({
      preview,
      execute: () => client.executeRemove(req),
      removeContext: nextCtx,
    });
  };

  const openUpgradePreview = async (scope: "all" | "author" | "skill", value?: string) => {
    const req =
      scope === "all"
        ? { scope }
        : scope === "author"
          ? { scope, ...(value ? { author: value } : {}) }
          : { scope, ...(value ? { skillId: value } : {}) };
    const preview = await client.previewUpgrade(req);
    setPreviewModal({ preview, execute: () => client.executeUpgrade(req) });
  };

  const openMigratePreview = async (skillIds: readonly string[]) => {
    const req = { skillIds, cleanupLegacyLockfiles: true };
    const preview = await client.previewMigrateToApm(req);
    setPreviewModal({ preview, execute: () => client.executeMigrateToApm(req) });
  };

  const toggleSidebarSection = (section: "views" | "primitives" | "harnesses") => {
    setCollapsedSidebarSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const resetFilters = () => {
    setSearch("");
    setHarnessFilter("all");
    setScopeFilter("all");
    setAuthorFilter("all");
    setManagerFilter("all");
    setHealthFilter("all");
    setPage(0);
  };

  const brokenCount = data?.snapshot.skills.filter((s) => s.hasBrokenLinks).length ?? 0;
  const driftCount = data?.snapshot.skills.filter((s) => s.hasDrift).length ?? 0;
  const duplicatesCount = data?.snapshot.skills.filter((s) => Boolean(s.duplicates)).length ?? 0;
  const unusedCount =
    data?.snapshot.skills.filter((s) => (s.usage?.activationCount ?? 0) === 0).length ?? 0;
  const updatesCount =
    data?.snapshot.skills.filter((s) => s.provenance.updateStatus.updateAvailable).length ?? 0;

  const contextStats = useMemo((): readonly {
    label: string;
    value: string;
    icon: typeof Layers;
  }[] => {
    if (!data) return [];
    switch (view) {
      case "home": {
        const activeCount = data.snapshot.skills.filter(
          (s) => (s.usage?.activationCount ?? 0) > 0,
        ).length;
        return [
          {
            label: "Total Skills",
            value: `${data.snapshot.skills.length} (${activeCount} active)`,
            icon: Layers,
          },
          {
            label: "Token Footprint (Desc)",
            value: `${data.telemetry.totalTokens.descriptionTokens.toLocaleString()} / ${data.telemetry.projectTokens.descriptionTokens.toLocaleString()}`,
            icon: Cpu,
          },
          {
            label: "Drift / Duplicates",
            value: `${driftCount} / ${duplicatesCount}`,
            icon: GitCompare,
          },
          {
            label: "Cleanup Candidates",
            value: String(cleanupCandidates.length),
            icon: Sparkles,
          },
        ];
      }
      case "inventory": {
        const descSum = filteredSkills.reduce((acc, s) => acc + s.tokens.descriptionTokens, 0);
        const fullSum = filteredSkills.reduce((acc, s) => acc + s.tokens.fullTokens, 0);
        const alerts = filteredSkills.filter((s) => s.hasBrokenLinks || s.hasDrift).length;
        return [
          {
            label: harnessFilter === "all" ? "Matching Skills" : `${harnessFilter} Skills`,
            value:
              filteredSkills.length === data.snapshot.skills.length
                ? String(filteredSkills.length)
                : `${filteredSkills.length} / ${data.snapshot.skills.length}`,
            icon: Layers,
          },
          { label: "Desc Tokens", value: descSum.toLocaleString(), icon: Cpu },
          { label: "Full Tokens", value: fullSum.toLocaleString(), icon: FileText },
          { label: "Broken / Drift", value: String(alerts), icon: AlertTriangle },
        ];
      }
      case "cleanup": {
        const impact = cleanupPreview?.impact;
        return [
          {
            label: "Cleanup Candidates",
            value: String(cleanupCandidates.length),
            icon: Sparkles,
          },
          {
            label: "Queued Actions",
            value: impact
              ? `${impact.selectedCount} (${impact.removeCount} rm · ${impact.migrateCount} apm)`
              : String(cleanupQueue.length),
            icon: Trash2,
          },
          {
            label: "Est. Desc Freed",
            value: impact
              ? `-${impact.tokensSavedDesc.toLocaleString()} (-${impact.tokensSavedDescPct}%)`
              : "0 (0%)",
            icon: Cpu,
          },
          {
            label: "Est. Full Freed",
            value: impact
              ? `-${impact.tokensSavedFull.toLocaleString()} (-${impact.tokensSavedFullPct}%)`
              : "0 (0%)",
            icon: FileText,
          },
        ];
      }
      case "tokens": {
        const topHarness = data.telemetry.byHarness[0];
        const heaviestProject = data.telemetry.byProject[0];
        return [
          {
            label: "Global / User (Desc / Full)",
            value: `${data.telemetry.totalTokens.descriptionTokens.toLocaleString()} / ${data.telemetry.totalTokens.fullTokens.toLocaleString()}`,
            icon: Globe,
          },
          {
            label: "Projects (Desc / Full)",
            value: `${data.telemetry.projectTokens.descriptionTokens.toLocaleString()} / ${data.telemetry.projectTokens.fullTokens.toLocaleString()}`,
            icon: FolderGit2,
          },
          {
            label: "Top Harness (Desc)",
            value: topHarness
              ? `${topHarness.harnessId} (${topHarness.tokens.descriptionTokens.toLocaleString()})`
              : "—",
            icon: Cpu,
          },
          {
            label: "Heaviest Project",
            value: heaviestProject
              ? `${heaviestProject.projectRoot.split("/").pop() || heaviestProject.projectRoot} (${heaviestProject.tokens.fullTokens.toLocaleString()})`
              : "—",
            icon: Flame,
          },
        ];
      }
      case "projects": {
        const projSkills = data.snapshot.skills.filter((s) => s.projectCount > 0);
        const uniqueProjects = new Set(projSkills.flatMap((s) => s.projectPaths)).size;
        const drifted = projSkills.filter((s) => s.hasDrift).length;
        const inSync = projSkills.length - drifted;
        return [
          { label: "Skills in Projects", value: String(projSkills.length), icon: Layers },
          { label: "Unique Workspaces", value: String(uniqueProjects), icon: FolderGit2 },
          { label: "In Sync", value: String(inSync), icon: CheckCircle2 },
          { label: "Drifted", value: String(drifted), icon: GitCompare },
        ];
      }
      case "sources": {
        const installed = data.sources.reduce((acc, s) => acc + s.installedCount, 0);
        const available = data.sources.reduce((acc, s) => acc + s.availableCount, 0);
        const deprecated = data.sources.reduce((acc, s) => acc + s.deprecatedCount, 0);
        return [
          { label: "Sources / Repos", value: String(data.sources.length), icon: Package },
          { label: "Installed", value: String(installed), icon: CheckCircle2 },
          { label: "Available", value: String(available), icon: Plus },
          { label: "Deprecated", value: String(deprecated), icon: AlertTriangle },
        ];
      }
      case "discover": {
        const skillsList = discoverData?.skills ?? [];
        const installedCount = skillsList.filter((s) => s.isInstalled).length;
        const topInstalls = skillsList.reduce((max, s) => Math.max(max, s.installs), 0);
        return [
          { label: "Discovered", value: String(skillsList.length), icon: Compass },
          { label: "Source", value: discoverData?.provider ?? "skills.sh", icon: Globe },
          { label: "Already Installed", value: String(installedCount), icon: CheckCircle2 },
          { label: "Top Installs", value: topInstalls.toLocaleString(), icon: Flame },
        ];
      }
      case "sessions": {
        const harnessesCount = new Set(sessionsData.map((s) => s.harnessId)).size;
        const projectsCount = new Set(sessionsData.map((s) => s.projectFolder).filter(Boolean))
          .size;
        const totalMsgs = sessionsData.reduce((acc, s) => acc + s.messageCount, 0);
        return [
          { label: "Recent Sessions", value: String(sessionsData.length), icon: History },
          { label: "Active Harnesses", value: String(harnessesCount), icon: Boxes },
          { label: "Workspaces", value: String(projectsCount), icon: FolderGit2 },
          { label: "Head Messages", value: totalMsgs.toLocaleString(), icon: FileText },
        ];
      }
      case "primitives": {
        return [
          {
            label: "MCP Servers",
            value: String(primitivesData?.mcpServers.length ?? 0),
            icon: Boxes,
          },
          {
            label: "Commands",
            value: String(primitivesData?.commands.length ?? 0),
            icon: FileText,
          },
          {
            label: "Prompts & Hooks",
            value: String(
              (primitivesData?.prompts.length ?? 0) + (primitivesData?.hooks.length ?? 0),
            ),
            icon: Layers,
          },
          {
            label: "LSP Servers",
            value: String(primitivesData?.lsps.length ?? 0),
            icon: Cpu,
          },
        ];
      }
    }
  }, [
    cleanupCandidates.length,
    cleanupPreview,
    cleanupQueue.length,
    data,
    discoverData,
    driftCount,
    duplicatesCount,
    filteredSkills,
    harnessFilter,
    primitivesData,
    sessionsData,
    view,
  ]);

  const renderScopeBadges = (skill: SkillRecord) => {
    const hasUser = skill.exposures.some((e) => e.scope === "global");
    const hasProject = skill.exposures.some((e) => e.scope === "project");
    const profiles = Array.from(
      new Set(skill.exposures.map((e) => e.profile).filter((p): p is string => Boolean(p))),
    );
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {hasUser && (
          <span className="badge" title="User / global scope">
            <Globe size={10} aria-hidden="true" />
            <span>user</span>
          </span>
        )}
        {hasProject && (
          <span className="badge" title="Project / workspace scope">
            <FolderGit2 size={10} aria-hidden="true" />
            <span>project</span>
          </span>
        )}
        {!hasUser && !hasProject && <span className="badge">—</span>}
        {profiles.map((p) => (
          <span key={p} className="badge warn" title={`Profile: ${p}`}>
            {p}
          </span>
        ))}
      </span>
    );
  };

  const renderSkillCard = (skill: SkillRecord) => {
    const uniqueHarnesses = Array.from(new Set(skill.exposures.map((e) => e.harnessId)));
    return (
      <article
        key={skill.id}
        className="discover-card"
        style={{ cursor: "pointer" }}
        onClick={() => setSelectedSkillId(skill.id)}
      >
        <div className="discover-card-head">
          <div>
            <strong style={{ fontSize: 13.5 }}>{skill.name}</strong>
            <div
              className="mono"
              style={{
                color: "var(--muted)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <SourceIcon
                manager={skill.provenance.owningManager}
                sourceRepo={skill.provenance.sourceRepo}
                sourceName={skill.provenance.author}
                size={11}
              />
              <span>{skill.provenance.author}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {renderScopeBadges(skill)}
            <span className="badge">{skill.provenance.owningManager}</span>
          </div>
        </div>

        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          {(skill.description || "No description").slice(0, 110)}
          {skill.description && skill.description.length > 110 ? "…" : ""}
        </div>

        <div className="harness-icons-row">
          {uniqueHarnesses.slice(0, 6).map((h) => (
            <span key={h} className="harness-icon-chip" title={h}>
              <HarnessIcon harnessId={h} size={12} />
            </span>
          ))}
          {uniqueHarnesses.length > 6 && (
            <span className="badge">+{uniqueHarnesses.length - 6}</span>
          )}
        </div>

        <div className="discover-card-foot" onClick={(e) => e.stopPropagation()}>
          <span className="mono" style={{ color: "var(--muted)" }}>
            d:{skill.tokens.descriptionTokens} · f:{skill.tokens.fullTokens}
          </span>
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              onClick={() => void openUpgradePreview("skill", skill.id)}
            >
              <ArrowUpCircle size={12} aria-hidden="true" />
              <span>Upgrade</span>
            </button>
            <button
              type="button"
              className="btn danger"
              aria-label={`Remove ${skill.name}`}
              onClick={() => void openRemovePreview(skill)}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="layout">
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-left">
            <Boxes size={15} color="var(--accent-text)" aria-hidden="true" />
            <span>harness-control</span>
          </div>
          <button
            type="button"
            className="btn"
            style={{ minBlockSize: 22, padding: "2px 6px", fontSize: 10.5 }}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? (
              <Sun size={12} aria-hidden="true" />
            ) : (
              <Moon size={12} aria-hidden="true" />
            )}
            <span>{theme === "dark" ? "LIGHT" : "DARK"}</span>
          </button>
        </div>

        <nav aria-label="Dashboard views">
          <button
            type="button"
            className="nav-group-toggle"
            aria-expanded={!collapsedSidebarSections.has("views")}
            onClick={() => toggleSidebarSection("views")}
          >
            <span>Views</span>
            {collapsedSidebarSections.has("views") ? (
              <ChevronRight size={12} aria-hidden="true" />
            ) : (
              <ChevronDown size={12} aria-hidden="true" />
            )}
          </button>
          {!collapsedSidebarSections.has("views") && (
            <ul className="nav-list">
              {(
                [
                  "home",
                  "inventory",
                  "cleanup",
                  "sessions",
                  "discover",
                  "tokens",
                  "projects",
                  "sources",
                ] as const
              ).map((id) => {
                const Icon = VIEW_ICONS[id];
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className="nav-btn"
                      aria-current={view === id ? "page" : undefined}
                      onClick={() => setView(id)}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <Icon size={13} aria-hidden="true" />
                        <span>{VIEW_TITLES[id]}</span>
                      </span>
                      {id === "inventory" && data && (
                        <span className="count-pill">{data.snapshot.skills.length}</span>
                      )}
                      {id === "cleanup" && cleanupCandidates.length > 0 && (
                        <span className="count-pill">{cleanupCandidates.length}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <nav className="primitives-nav" aria-label="Primitives">
          <button
            type="button"
            className="nav-group-toggle"
            aria-expanded={!collapsedSidebarSections.has("primitives")}
            onClick={() => toggleSidebarSection("primitives")}
          >
            <span>Primitives</span>
            {collapsedSidebarSections.has("primitives") ? (
              <ChevronRight size={12} aria-hidden="true" />
            ) : (
              <ChevronDown size={12} aria-hidden="true" />
            )}
          </button>
          {!collapsedSidebarSections.has("primitives") && (
            <ul className="nav-list">
              {PRIMITIVE_NAV.map((p) => {
                const isActive =
                  (p.id === "skill" && view === "inventory") ||
                  (view === "primitives" && primitiveTab === p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="nav-btn"
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => {
                        if (p.id === "skill") {
                          setView("inventory");
                        } else {
                          setPrimitiveTab(p.id);
                          setView("primitives");
                        }
                      }}
                    >
                      <span>{p.label}</span>
                      {p.id !== "skill" && primitivesData && (
                        <span className="count-pill">
                          {p.id === "mcp"
                            ? primitivesData.mcpServers.length
                            : p.id === "command"
                              ? primitivesData.commands.length
                              : p.id === "prompt"
                                ? primitivesData.prompts.length
                                : p.id === "hook"
                                  ? primitivesData.hooks.length
                                  : primitivesData.lsps.length}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {data && (
          <nav className="harness-sidebar-nav" aria-label="Global harnesses">
            <button
              type="button"
              className="nav-group-toggle"
              aria-expanded={!collapsedSidebarSections.has("harnesses")}
              onClick={() => toggleSidebarSection("harnesses")}
            >
              <span>Harnesses ({data.harnesses.length})</span>
              {collapsedSidebarSections.has("harnesses") ? (
                <ChevronRight size={12} aria-hidden="true" />
              ) : (
                <ChevronDown size={12} aria-hidden="true" />
              )}
            </button>
            {!collapsedSidebarSections.has("harnesses") && (
              <>
                <div className="sidebar-search-wrap">
                  <Search size={12} className="sidebar-search-icon" aria-hidden="true" />
                  <input
                    type="search"
                    className="sidebar-search-input"
                    placeholder="Filter harnesses..."
                    aria-label="Filter harnesses"
                    value={harnessSearch}
                    onChange={(e) => setHarnessSearch(e.target.value)}
                  />
                </div>
                <ul className="nav-list">
                  {!harnessSearch.trim() && (
                    <li>
                      <button
                        type="button"
                        className="nav-btn"
                        aria-pressed={harnessFilter === "all"}
                        onClick={() => {
                          setHarnessFilter("all");
                          setView("inventory");
                          setPage(0);
                        }}
                      >
                        <span>All Harnesses</span>
                        <span className="count-pill">{data.snapshot.skills.length}</span>
                      </button>
                    </li>
                  )}
                  {data.harnesses
                    .filter((h) => {
                      const q = harnessSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        h.displayName.toLowerCase().includes(q) || h.id.toLowerCase().includes(q)
                      );
                    })
                    .map((h) => {
                      const count = harnessCounts.get(h.id) ?? 0;
                      return (
                        <li key={h.id}>
                          <button
                            type="button"
                            className="nav-btn"
                            aria-pressed={harnessFilter === h.id}
                            onClick={() => {
                              setHarnessFilter(h.id);
                              setView("inventory");
                              setPage(0);
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                              <HarnessIcon harnessId={h.id} size={13} />
                              <span>{h.displayName}</span>
                            </span>
                            <span className="count-pill">{count}</span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </>
            )}
          </nav>
        )}

        <div className="panel" style={{ marginTop: "auto", padding: "8px 10px" }}>
          <div className="nav-group-label" style={{ padding: 0, marginBottom: 4 }}>
            Core Daemon
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            {daemonStatus && <span className="daemon-dot" aria-hidden="true" />}
            <span className={`badge ${daemonStatus ? "ok" : "danger"}`}>
              {daemonStatus ? "ONLINE" : "OFFLINE"}
            </span>
            {daemonStatus && (
              <span className="mono" style={{ color: "var(--muted)" }}>
                :{daemonStatus.port}
              </span>
            )}
          </div>
          {daemonStatus && (
            <div className="mono" style={{ color: "var(--muted)", fontSize: 10.5 }}>
              pid {daemonStatus.pid} · up {daemonStatus.uptimeSeconds}s
            </div>
          )}
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="main">
        <div role="status" className="visually-hidden">
          {liveAnnouncement}
        </div>

        <header className="topbar">
          <div>
            <h1>
              {VIEW_TITLES[view]}
              {view === "inventory" && harnessFilter !== "all" ? ` / ${harnessFilter}` : ""}
            </h1>
            {data && (
              <span className="mono" style={{ color: "var(--muted)" }}>
                {data.snapshot.harnessesScanned.length} harnesses · {filteredSkills.length} matching
              </span>
            )}
          </div>
          <div className="toolbar">
            <div className="chip-group" role="group" aria-label="Layout mode">
              <button
                type="button"
                className={`btn ${layoutMode === "list" ? "active-chip" : ""}`}
                aria-pressed={layoutMode === "list"}
                onClick={() => setLayoutMode("list")}
              >
                <ListIcon size={12} aria-hidden="true" />
                <span>List</span>
              </button>
              <button
                type="button"
                className={`btn ${layoutMode === "cards" ? "active-chip" : ""}`}
                aria-pressed={layoutMode === "cards"}
                onClick={() => setLayoutMode("cards")}
              >
                <LayoutGrid size={12} aria-hidden="true" />
                <span>Cards</span>
              </button>
            </div>
            <button
              type="button"
              className={`btn ${view === "cleanup" ? "active-chip" : ""}`}
              disabled={!data || loading}
              onClick={() => setView("cleanup")}
            >
              <Sparkles size={13} aria-hidden="true" />
              <span>Cleanup</span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={!data || loading}
              onClick={() => void openUpgradePreview("all")}
            >
              <ArrowUpCircle size={13} aria-hidden="true" />
              <span>Upgrade All</span>
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={loading}
              onClick={() => void load(true)}
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span>{loading ? "Scanning..." : "Rescan"}</span>
            </button>
          </div>
        </header>

        {banner && (
          <div className="banner" role="status">
            <span>{banner}</span>
            <button type="button" className="btn" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="banner error" role="alert">
            <span>Daemon unavailable: {error}. Start it with `task dev:server`.</span>
            <button type="button" className="btn" onClick={() => void load(false)}>
              Retry
            </button>
          </div>
        )}

        {data && (
          <section className="stats-strip" aria-label={`${VIEW_TITLES[view]} metrics`}>
            {contextStats.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="stat-tile">
                  <div
                    className="stat-label"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <Icon size={11} aria-hidden="true" />
                    <span>{stat.label}</span>
                  </div>
                  <div className="stat-value">{stat.value}</div>
                </div>
              );
            })}
          </section>
        )}

        {loading && !data && (
          <div className="panel" aria-busy="true" aria-label="Loading inventory">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        )}

        {view === "home" && data && (
          <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
            <section
              className="panel"
              style={{
                padding: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                borderColor: "var(--accent)",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <h2 style={{ margin: 0, fontSize: 17 }}>Unified AI Harness Control Plane</h2>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  {data.snapshot.skills.length} skills across{" "}
                  {data.snapshot.harnessesScanned.length} harnesses · {brokenCount} broken ·{" "}
                  {driftCount} drifted · {duplicatesCount} duplicated · {unusedCount} unused
                </div>
              </div>
              <div className="toolbar">
                <button type="button" className="btn primary" onClick={() => setView("cleanup")}>
                  <Sparkles size={14} aria-hidden="true" />
                  <span>Open Cleanup ({cleanupCandidates.length})</span>
                </button>
                <button type="button" className="btn" onClick={() => setView("inventory")}>
                  <Layers size={14} aria-hidden="true" />
                  <span>Browse Library</span>
                </button>
                <button type="button" className="btn" onClick={() => setView("discover")}>
                  <Compass size={14} aria-hidden="true" />
                  <span>Discover Skills</span>
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void openUpgradePreview("all")}
                >
                  <ArrowUpCircle size={14} aria-hidden="true" />
                  <span>Upgrade All</span>
                </button>
              </div>
            </section>

            <section className="discover-grid" aria-label="Workspace views">
              {(
                [
                  {
                    id: "inventory" as const,
                    title: "Skills Library",
                    desc: "Browse, filter by scope/manager/source, inspect SKILL.md, and resolve individual conflicts.",
                    meta: `${data.snapshot.skills.length} skills`,
                    icon: Layers,
                  },
                  {
                    id: "cleanup" as const,
                    title: "Cleanup Planner",
                    desc: "Queue deduplication, drift resolution, unused removal, and migration with token-savings preview.",
                    meta: `${cleanupCandidates.length} candidates`,
                    icon: Sparkles,
                  },
                  {
                    id: "discover" as const,
                    title: "Discover & Install",
                    desc: "Search skills.sh & npx skills trending catalogs and install via npx-skills or APM.",
                    meta: "skills.sh + CLI",
                    icon: Compass,
                  },
                  {
                    id: "tokens" as const,
                    title: "Token Usage",
                    desc: "Measure global vs project token footprint, heaviest harnesses, sources, and workspaces.",
                    meta: `${data.telemetry.totalTokens.descriptionTokens.toLocaleString()} desc tokens`,
                    icon: Cpu,
                  },
                  {
                    id: "projects" as const,
                    title: "Projects & Drift",
                    desc: "Audit project-level skill overrides, global/project overlap, and multi-manager drift.",
                    meta: `${driftCount} drifted`,
                    icon: FolderGit2,
                  },
                  {
                    id: "sources" as const,
                    title: "Sources & Catalog",
                    desc: "Inspect upstream GitHub repos, Claude marketplaces, deprecations, and batch upgrades.",
                    meta: `${data.sources.length} sources`,
                    icon: Package,
                  },
                ] as const
              ).map((card) => {
                const Icon = card.icon;
                return (
                  <article
                    key={card.id}
                    className="discover-card"
                    style={{ cursor: "pointer" }}
                    onClick={() => setView(card.id)}
                  >
                    <div className="discover-card-head">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <Icon size={15} aria-hidden="true" />
                        <strong style={{ fontSize: 14 }}>{card.title}</strong>
                      </span>
                      <span className="badge">{card.meta}</span>
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{card.desc}</div>
                  </article>
                );
              })}
            </section>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                gap: 14,
              }}
            >
              <section className="panel" style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <h2 style={{ margin: 0 }}>Heaviest Skills (Full Tokens)</h2>
                  <button type="button" className="text-link" onClick={() => setView("inventory")}>
                    View all
                  </button>
                </div>
                <div className="table-wrapper">
                  <table>
                    <tbody>
                      {[...data.snapshot.skills]
                        .sort((a, b) => b.tokens.fullTokens - a.tokens.fullTokens)
                        .slice(0, 5)
                        .map((sk) => (
                          <tr key={sk.id} onClick={() => setSelectedSkillId(sk.id)}>
                            <td>
                              <strong>{sk.name}</strong>
                            </td>
                            <td>
                              <span className="badge">{sk.provenance.owningManager}</span>
                            </td>
                            <td className="mono num">{sk.tokens.fullTokens.toLocaleString()}t</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel" style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <h2 style={{ margin: 0 }}>Heaviest Projects</h2>
                  <button type="button" className="text-link" onClick={() => setView("tokens")}>
                    Token details
                  </button>
                </div>
                {data.telemetry.byProject.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    No project-scoped skills discovered.
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table>
                      <tbody>
                        {data.telemetry.byProject.slice(0, 5).map((p) => (
                          <tr key={p.projectRoot} onClick={() => setView("projects")}>
                            <td>
                              <span className="mono" title={p.projectRoot}>
                                {p.projectRoot.split("/").slice(-2).join("/")}
                              </span>
                            </td>
                            <td className="mono num">{p.skillCount} skills</td>
                            <td className="mono num">{p.tokens.fullTokens.toLocaleString()}t</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {view === "inventory" && data && (
          <>
            <div className="filter-panel">
              <div className="filter-row">
                <div className="filter-group" style={{ flex: 1, minWidth: 280 }}>
                  <label htmlFor={searchId} className="visually-hidden">
                    Filter skills by name, author, or description
                  </label>
                  <input
                    id={searchId}
                    type="search"
                    placeholder="Search skills, sources, descriptions..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                    style={{ minWidth: 240, flex: "1 1 240px", maxWidth: 340 }}
                  />

                  <span className="filter-group-label">Facets</span>
                  <label htmlFor={managerSelectId} className="visually-hidden">
                    Filter by package manager
                  </label>
                  <select
                    id={managerSelectId}
                    value={managerFilter}
                    onChange={(e) => {
                      setManagerFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">All Managers</option>
                    <option value="apm">APM</option>
                    <option value="npx-skills">npx skills</option>
                    <option value="claude-plugin">Claude Plugin</option>
                    <option value="antigravity-plugin">Antigravity Plugin</option>
                    <option value="gemini-extension">Gemini Extension</option>
                    <option value="git-clone">git clone</option>
                    <option value="manual">manual</option>
                  </select>

                  <label htmlFor={authorSelectId} className="visually-hidden">
                    Filter by source
                  </label>
                  <select
                    id={authorSelectId}
                    value={authorFilter}
                    onChange={(e) => {
                      setAuthorFilter(e.target.value);
                      setPage(0);
                    }}
                    style={{ maxWidth: 180 }}
                  >
                    <option value="all">All Sources</option>
                    {authorList.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>

                  <label htmlFor={groupBySelectId} className="visually-hidden">
                    Group skills by
                  </label>
                  <select
                    id={groupBySelectId}
                    value={groupBy}
                    onChange={(e) => {
                      setGroupBy(e.target.value as "none" | "source" | "manager" | "harness");
                      setCollapsedGroups(new Set());
                    }}
                  >
                    <option value="none">Group: None</option>
                    <option value="source">Group: Source</option>
                    <option value="manager">Group: Manager</option>
                    <option value="harness">Group: Harness</option>
                  </select>
                </div>

                <div className="filter-group">
                  <span className="filter-group-label">Scope</span>
                  <div className="chip-group" role="group" aria-label="Scope filters">
                    {(
                      [
                        { id: "all", label: "All Scope", icon: Layers },
                        { id: "global", label: "Global", icon: Globe },
                        { id: "project", label: "Project", icon: FolderGit2 },
                      ] as const
                    ).map((sc) => {
                      const Icon = sc.icon;
                      return (
                        <button
                          key={sc.id}
                          type="button"
                          className={`btn ${scopeFilter === sc.id ? "active-chip" : ""}`}
                          aria-pressed={scopeFilter === sc.id}
                          onClick={() => {
                            setScopeFilter(sc.id);
                            setPage(0);
                          }}
                        >
                          <Icon size={12} aria-hidden="true" />
                          <span>{sc.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="filter-row">
                <div className="filter-group" style={{ flex: 1 }}>
                  <span className="filter-group-label">Health &amp; Status</span>
                  <div
                    className="underline-tabs"
                    role="group"
                    aria-label="Status filters"
                    style={{ borderBottom: 0 }}
                  >
                    <button
                      type="button"
                      className="underline-tab"
                      aria-pressed={healthFilter === "all"}
                      onClick={() => {
                        setHealthFilter("all");
                        setPage(0);
                      }}
                    >
                      <Layers size={13} aria-hidden="true" />
                      <span>All</span>
                      <span className="count-pill">{data.snapshot.skills.length}</span>
                    </button>
                    <button
                      type="button"
                      className="underline-tab"
                      aria-pressed={healthFilter === "broken"}
                      onClick={() => {
                        setHealthFilter("broken");
                        setPage(0);
                      }}
                    >
                      <Link2Off size={13} aria-hidden="true" />
                      <span>Broken</span>
                      <span className="count-pill">{brokenCount}</span>
                    </button>
                    <button
                      type="button"
                      className="underline-tab"
                      aria-pressed={healthFilter === "drift"}
                      onClick={() => {
                        setHealthFilter("drift");
                        setPage(0);
                      }}
                    >
                      <GitCompare size={13} aria-hidden="true" />
                      <span>Drift</span>
                      <span className="count-pill">{driftCount}</span>
                    </button>
                    <button
                      type="button"
                      className="underline-tab"
                      aria-pressed={healthFilter === "duplicates"}
                      onClick={() => {
                        setHealthFilter("duplicates");
                        setPage(0);
                      }}
                    >
                      <Copy size={13} aria-hidden="true" />
                      <span>Duplicates</span>
                      <span className="count-pill">{duplicatesCount}</span>
                    </button>
                    <button
                      type="button"
                      className="underline-tab"
                      aria-pressed={healthFilter === "unused"}
                      onClick={() => {
                        setHealthFilter("unused");
                        setPage(0);
                      }}
                    >
                      <Clock size={13} aria-hidden="true" />
                      <span>Unused</span>
                      <span className="count-pill">{unusedCount}</span>
                    </button>
                    <button
                      type="button"
                      className="underline-tab"
                      aria-pressed={healthFilter === "updates"}
                      onClick={() => {
                        setHealthFilter("updates");
                        setPage(0);
                      }}
                    >
                      <Download size={13} aria-hidden="true" />
                      <span>Updates</span>
                      <span className="count-pill">{updatesCount}</span>
                    </button>
                  </div>
                </div>
                {authorFilter !== "all" && (
                  <div className="toolbar">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void openUpgradePreview("author", authorFilter)}
                    >
                      <ArrowUpCircle size={12} aria-hidden="true" />
                      <span>Upgrade Source</span>
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => void openRemoveSourcePreview(authorFilter)}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      <span>Remove Source</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {healthFilter === "duplicates" && filteredSkills.length > 0 && (
              <div
                className="panel"
                style={{
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  borderColor: "var(--warning, #d97706)",
                }}
              >
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <Copy size={14} aria-hidden="true" />
                  <span>
                    <strong>
                      {
                        filteredSkills.filter((s) => (s.duplicates?.siblingIds.length ?? 0) > 0)
                          .length
                      }
                    </strong>{" "}
                    cross-skill duplicate(s) ·{" "}
                    <strong>
                      {filteredSkills.filter((s) => (s.duplicates?.physicalCopies ?? 0) > 1).length}
                    </strong>{" "}
                    multi-copy skill(s)
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Click any skill to inspect duplicate siblings or remove extra copies via manager
                  CLI.
                </span>
              </div>
            )}

            {filteredSkills.length === 0 ? (
              <div className="panel empty-state">
                <div>No skills match the current filters.</div>
                <button type="button" className="btn" onClick={resetFilters}>
                  Reset filters
                </button>
              </div>
            ) : groupedSkills ? (
              <div style={{ display: "grid", gap: 10 }}>
                {groupedSkills.map(([groupKey, groupItems]) => {
                  const isCollapsed = collapsedGroups.has(groupKey);
                  const sample = groupItems[0];
                  return (
                    <section key={groupKey} className="panel">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <button
                          type="button"
                          className="source-group-toggle"
                          style={{ flex: 1 }}
                          aria-expanded={!isCollapsed}
                          onClick={() =>
                            setCollapsedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(groupKey)) next.delete(groupKey);
                              else next.add(groupKey);
                              return next;
                            })
                          }
                        >
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            {isCollapsed ? (
                              <ChevronRight size={14} aria-hidden="true" />
                            ) : (
                              <ChevronDown size={14} aria-hidden="true" />
                            )}
                            {groupBy === "source" && sample && (
                              <SourceIcon
                                manager={sample.provenance.owningManager}
                                sourceRepo={sample.provenance.sourceRepo}
                                sourceName={groupKey}
                              />
                            )}
                            {groupBy === "harness" && (
                              <HarnessIcon harnessId={groupKey} size={14} />
                            )}
                            <h2 style={{ margin: 0 }}>{groupKey}</h2>
                          </div>
                          <span className="badge">{groupItems.length} skills</span>
                        </button>
                        {groupBy === "source" && (
                          <div className="toolbar">
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void openUpgradePreview("author", groupKey)}
                            >
                              <ArrowUpCircle size={12} aria-hidden="true" />
                              <span>Upgrade</span>
                            </button>
                            <button
                              type="button"
                              className="btn danger"
                              onClick={() => void openRemoveSourcePreview(groupKey)}
                            >
                              <Trash2 size={12} aria-hidden="true" />
                              <span>Remove</span>
                            </button>
                          </div>
                        )}
                      </div>
                      {!isCollapsed && (
                        <div style={{ marginTop: 10 }}>
                          {layoutMode === "cards" ? (
                            <div className="discover-grid">{groupItems.map(renderSkillCard)}</div>
                          ) : (
                            <div className="table-wrapper" tabIndex={0}>
                              <table>
                                <tbody>
                                  {groupItems.map((sk) => (
                                    <tr key={sk.id} onClick={() => setSelectedSkillId(sk.id)}>
                                      <td>
                                        <strong>{sk.name}</strong>
                                      </td>
                                      <td>
                                        <span className="badge">{sk.provenance.owningManager}</span>
                                      </td>
                                      <td>{renderScopeBadges(sk)}</td>
                                      <td className="mono num">{sk.tokens.descriptionTokens}t</td>
                                      <td className="mono num">{sk.tokens.fullTokens}t</td>
                                      <td className="mono num">{sk.projectCount} proj</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : layoutMode === "cards" ? (
              <div className="discover-grid">{pagedSkills.map(renderSkillCard)}</div>
            ) : (
              <div
                className="table-wrapper"
                tabIndex={0}
                role="region"
                aria-labelledby={invCaptionId}
              >
                <table>
                  <caption id={invCaptionId} className="visually-hidden">
                    Discovered skills inventory across harnesses and projects
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" aria-sort={sortCol === "name" ? sortDir : undefined}>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleSort("name")}
                        >
                          <span>Skill</span>
                          <SortIcon direction={sortCol === "name" ? sortDir : undefined} />
                        </button>
                      </th>
                      <th scope="col" aria-sort={sortCol === "author" ? sortDir : undefined}>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleSort("author")}
                        >
                          <span>Source</span>
                          <SortIcon direction={sortCol === "author" ? sortDir : undefined} />
                        </button>
                      </th>
                      <th scope="col" aria-sort={sortCol === "manager" ? sortDir : undefined}>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleSort("manager")}
                        >
                          <span>Manager</span>
                          <SortIcon direction={sortCol === "manager" ? sortDir : undefined} />
                        </button>
                      </th>
                      <th scope="col">Scope</th>
                      <th scope="col">Harnesses</th>
                      <th scope="col" aria-sort={sortCol === "descTokens" ? sortDir : undefined}>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleSort("descTokens")}
                        >
                          <span>Desc</span>
                          <SortIcon direction={sortCol === "descTokens" ? sortDir : undefined} />
                        </button>
                      </th>
                      <th scope="col" aria-sort={sortCol === "fullTokens" ? sortDir : undefined}>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleSort("fullTokens")}
                        >
                          <span>Full</span>
                          <SortIcon direction={sortCol === "fullTokens" ? sortDir : undefined} />
                        </button>
                      </th>
                      <th scope="col" aria-sort={sortCol === "projects" ? sortDir : undefined}>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleSort("projects")}
                        >
                          <span>Proj</span>
                          <SortIcon direction={sortCol === "projects" ? sortDir : undefined} />
                        </button>
                      </th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSkills.map((skill) => {
                      const isSelected = selectedSkillId === skill.id;
                      const uniqueExposures = Array.from(
                        new Map(skill.exposures.map((e) => [e.harnessId, e])).values(),
                      );
                      const popoverId = `harnesses-${skill.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                      return (
                        <tr
                          key={skill.id}
                          data-selected={isSelected}
                          onClick={() => setSelectedSkillId(isSelected ? null : skill.id)}
                        >
                          <td>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                flexWrap: "wrap",
                              }}
                            >
                              <strong>{skill.name}</strong>
                              {skill.hasBrokenLinks && (
                                <span className="badge danger" title="Broken symlink exposure(s)">
                                  <Link2Off size={10} aria-hidden="true" />
                                </span>
                              )}
                              {skill.hasDrift && (
                                <span
                                  className="badge warn"
                                  title={skill.driftDetails?.summary ?? "Drift detected"}
                                >
                                  <GitCompare size={10} aria-hidden="true" />
                                </span>
                              )}
                              {skill.duplicates && (
                                <span
                                  className="badge warn"
                                  title={`Duplicates: ${skill.duplicates.reasons.join(", ")}`}
                                >
                                  <Copy size={10} aria-hidden="true" />
                                </span>
                              )}
                            </span>
                          </td>
                          <td>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <SourceIcon
                                manager={skill.provenance.owningManager}
                                sourceRepo={skill.provenance.sourceRepo}
                                sourceName={skill.provenance.author}
                              />
                              <span>{skill.provenance.author}</span>
                            </span>
                          </td>
                          <td>
                            <span className="badge">{skill.provenance.owningManager}</span>
                          </td>
                          <td>{renderScopeBadges(skill)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="harness-icons-row">
                              {uniqueExposures.slice(0, 5).map((exp) => (
                                <span
                                  key={exp.harnessId}
                                  className={`harness-icon-chip ${
                                    exp.linkType === "symlink-broken" ? "broken" : ""
                                  }`}
                                  title={`${exp.harnessId} (${exp.scope}:${exp.linkType})`}
                                  aria-label={exp.harnessId}
                                >
                                  <HarnessIcon harnessId={exp.harnessId} size={13} />
                                </span>
                              ))}
                              {uniqueExposures.length > 0 && (
                                <>
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{ minBlockSize: 24, padding: "2px 6px", fontSize: 11 }}
                                    popoverTarget={popoverId}
                                    aria-label={`Show all ${uniqueExposures.length} harnesses for ${skill.name}`}
                                  >
                                    {uniqueExposures.length > 5 ? (
                                      <>
                                        <span>+{uniqueExposures.length - 5}</span>
                                        <ChevronDown size={11} aria-hidden="true" />
                                      </>
                                    ) : (
                                      <ChevronDown size={11} aria-hidden="true" />
                                    )}
                                  </button>
                                  <div id={popoverId} popover="auto" className="harness-popover">
                                    <div className="nav-group-label" style={{ padding: 0 }}>
                                      {skill.name} — Harnesses ({skill.exposures.length})
                                    </div>
                                    <ul className="harness-popover-list">
                                      {skill.exposures.map((exp, idx) => (
                                        <li key={idx} className="harness-popover-item">
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: 7,
                                            }}
                                          >
                                            <HarnessIcon harnessId={exp.harnessId} size={13} />
                                            <span>{exp.harnessId}</span>
                                          </span>
                                          <span
                                            className={`badge ${
                                              exp.linkType === "symlink-broken" ? "danger" : ""
                                            }`}
                                          >
                                            {exp.scope}:
                                            {exp.linkType === "physical-copy"
                                              ? "copy"
                                              : exp.linkType === "symlink-broken"
                                                ? "broken"
                                                : "link"}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="mono num">{skill.tokens.descriptionTokens}</td>
                          <td className="mono num">{skill.tokens.fullTokens}</td>
                          <td className="mono num">{skill.projectCount}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="toolbar" style={{ flexWrap: "nowrap" }}>
                              <button
                                type="button"
                                className="btn"
                                aria-label={`Upgrade ${skill.name}`}
                                onClick={() => void openUpgradePreview("skill", skill.id)}
                              >
                                <ArrowUpCircle size={12} aria-hidden="true" />
                                <span>Upgrade</span>
                              </button>
                              {skill.provenance.owningManager !== "apm" && (
                                <button
                                  type="button"
                                  className="btn"
                                  aria-label={`Migrate ${skill.name} to APM`}
                                  onClick={() => void openMigratePreview([skill.id])}
                                >
                                  <span>To APM</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn danger"
                                aria-label={`Remove ${skill.name}`}
                                onClick={() => void openRemovePreview(skill)}
                              >
                                <Trash2 size={12} aria-hidden="true" />
                                <span>Remove</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <dialog
              ref={skillDialogRef}
              className="skill-detail-dialog"
              aria-labelledby="skill-inspector-title"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelectedSkillId(null);
              }}
              onClose={(e) => {
                e.currentTarget.returnValue = "";
                setSelectedSkillId(null);
              }}
            >
              {selectedSkill && (
                <div className="dialog-body">
                  <div className="topbar" style={{ paddingBottom: 8 }}>
                    <div>
                      <h2 id="skill-inspector-title" style={{ margin: 0, fontSize: 16 }}>
                        {selectedSkill.name}
                      </h2>
                      <div className="mono" style={{ color: "var(--muted)" }}>
                        {selectedSkill.id}
                      </div>
                    </div>
                    <div className="toolbar">
                      {skillContent?.skillsShUrl && (
                        <a
                          href={skillContent.skillsShUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-link"
                        >
                          <span>skills.sh</span>
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      )}
                      <button
                        type="button"
                        className="icon-ghost-btn"
                        autoFocus
                        aria-label="Close inspector"
                        onClick={() => setSelectedSkillId(null)}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="underline-tabs" role="tablist" aria-label="Inspector tabs">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={inspectorTab === "overview"}
                      className="underline-tab"
                      onClick={() => setInspectorTab("overview")}
                    >
                      <Layers size={13} aria-hidden="true" />
                      <span>Overview</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={inspectorTab === "markdown"}
                      className="underline-tab"
                      onClick={() => setInspectorTab("markdown")}
                    >
                      <FileText size={13} aria-hidden="true" />
                      <span>SKILL.md</span>
                    </button>
                  </div>

                  {inspectorTab === "overview" ? (
                    <>
                      <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                        {selectedSkill.description || "No description provided in SKILL.md."}
                      </div>

                      <div>
                        <div className="nav-group-label" style={{ padding: 0 }}>
                          Token Breakdown
                        </div>
                        <div className="mono">
                          desc: {selectedSkill.tokens.descriptionTokens} · fm:{" "}
                          {selectedSkill.tokens.frontmatterTokens} · body:{" "}
                          {selectedSkill.tokens.bodyTokens} · full:{" "}
                          {selectedSkill.tokens.fullTokens}
                        </div>
                      </div>

                      <div>
                        <div className="nav-group-label" style={{ padding: 0 }}>
                          Latest Activation
                        </div>
                        <div className="mono" style={{ color: "var(--muted)" }}>
                          {selectedSkill.usage
                            ? `${selectedSkill.usage.activationCount} session(s) · last ${
                                selectedSkill.usage.lastUsedAt
                                  ? new Date(selectedSkill.usage.lastUsedAt).toLocaleString()
                                  : "unknown"
                              } (${selectedSkill.usage.lastHarness ?? "unknown"})`
                            : "No recent activations found in session logs"}
                        </div>
                      </div>

                      {(selectedSkill.driftDetails || selectedSkill.duplicates) && (
                        <div
                          className="panel"
                          style={{
                            padding: 12,
                            borderColor: "var(--warning, #d97706)",
                            background: "color-mix(in srgb, var(--surface) 88%, #d97706 12%)",
                            display: "grid",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <AlertTriangle size={14} aria-hidden="true" />
                              <strong>Drift &amp; Conflict Diagnostics</strong>
                              {selectedSkill.driftDetails?.reasons.map((r) => (
                                <span key={r} className="badge warn">
                                  {r.replace(/-/g, " ")}
                                </span>
                              ))}
                              {selectedSkill.duplicates?.reasons.map((r) => (
                                <span key={`dup-${r}`} className="badge warn">
                                  {r.replace(/-/g, " ")}
                                </span>
                              ))}
                            </div>
                            {selectedSkill.driftDetails?.hasGlobalAndProject && (
                              <button
                                type="button"
                                className="btn danger"
                                style={{ padding: "3px 8px", fontSize: 11 }}
                                onClick={() => void openRemovePreview(selectedSkill, "project")}
                              >
                                <Trash2 size={11} aria-hidden="true" />
                                <span>Remove Project Copies</span>
                              </button>
                            )}
                          </div>

                          {selectedSkill.driftDetails && (
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>
                              {selectedSkill.driftDetails.summary} · Managers:{" "}
                              <span className="mono">
                                {selectedSkill.driftDetails.managers.join(", ")}
                              </span>
                            </div>
                          )}

                          {selectedSkill.duplicates &&
                            selectedSkill.duplicates.siblingIds.length > 0 && (
                              <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                <div className="nav-group-label" style={{ padding: 0 }}>
                                  Duplicate Siblings ({selectedSkill.duplicates.siblingIds.length})
                                </div>
                                {selectedSkill.duplicates.siblingIds.map((sibId, idx) => {
                                  const sibling = data?.snapshot.skills.find((s) => s.id === sibId);
                                  const sibName =
                                    sibling?.name ??
                                    selectedSkill.duplicates?.siblingNames[idx] ??
                                    sibId;
                                  return (
                                    <div
                                      key={sibId}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        padding: "5px 8px",
                                        borderRadius: 4,
                                        background: "var(--bg)",
                                      }}
                                    >
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        <strong>{sibName}</strong>
                                        {sibling && (
                                          <>
                                            <span className="badge">
                                              {sibling.provenance.owningManager}
                                            </span>
                                            {renderScopeBadges(sibling)}
                                          </>
                                        )}
                                      </span>
                                      <div className="toolbar">
                                        <button
                                          type="button"
                                          className="btn"
                                          style={{ padding: "2px 8px", fontSize: 11 }}
                                          onClick={() => setSelectedSkillId(sibId)}
                                        >
                                          Inspect
                                        </button>
                                        {sibling && (
                                          <button
                                            type="button"
                                            className="btn danger"
                                            style={{ padding: "2px 8px", fontSize: 11 }}
                                            onClick={() => void openRemovePreview(sibling)}
                                          >
                                            <Trash2 size={11} aria-hidden="true" />
                                            <span>Remove</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                          {selectedSkill.driftDetails &&
                            selectedSkill.driftDetails.copies.length > 0 &&
                            (() => {
                              const byPath = new Map<
                                string,
                                {
                                  copy: (typeof selectedSkill.driftDetails.copies)[number];
                                  harnesses: string[];
                                }
                              >();
                              for (const c of selectedSkill.driftDetails.copies) {
                                const existing = byPath.get(c.path);
                                if (existing) {
                                  if (!existing.harnesses.includes(c.harnessId)) {
                                    existing.harnesses.push(c.harnessId);
                                  }
                                } else {
                                  byPath.set(c.path, { copy: c, harnesses: [c.harnessId] });
                                }
                              }
                              const uniqueCopies = Array.from(byPath.values());
                              const canRemoveScope =
                                (selectedSkill.driftDetails?.physicalCopies ?? 0) > 1 &&
                                ["apm", "npx-skills", "claude-plugin", "gemini-extension"].includes(
                                  selectedSkill.provenance.owningManager,
                                );
                              return (
                                <div style={{ display: "grid", gap: 4 }}>
                                  <div className="nav-group-label" style={{ padding: 0 }}>
                                    Detected Copies ({uniqueCopies.length} path
                                    {uniqueCopies.length === 1 ? "" : "s"} ·{" "}
                                    {selectedSkill.driftDetails.copies.length} exposures)
                                  </div>
                                  {uniqueCopies.map(({ copy, harnesses }) => (
                                    <div
                                      key={copy.path}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        fontSize: 11,
                                        padding: "4px 6px",
                                        borderRadius: 4,
                                        background: "var(--bg)",
                                      }}
                                    >
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                          minWidth: 0,
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        {harnesses.slice(0, 3).map((hId) => (
                                          <HarnessIcon key={hId} harnessId={hId} size={11} />
                                        ))}
                                        {harnesses.length > 3 && (
                                          <span className="badge">+{harnesses.length - 3}</span>
                                        )}
                                        <span
                                          className="badge"
                                          title={
                                            copy.scope === "global"
                                              ? "User / global scope"
                                              : "Project scope"
                                          }
                                        >
                                          {copy.scope === "global" ? (
                                            <Globe size={10} aria-hidden="true" />
                                          ) : (
                                            <FolderGit2 size={10} aria-hidden="true" />
                                          )}
                                        </span>
                                        <span
                                          className={`badge ${copy.linkType === "symlink-broken" ? "danger" : ""}`}
                                          title={
                                            copy.linkType === "physical-copy"
                                              ? "Physical copy"
                                              : copy.linkType === "symlink-broken"
                                                ? "Broken symlink"
                                                : "Healthy symlink"
                                          }
                                        >
                                          <LinkTypeIcon linkType={copy.linkType} size={10} />
                                        </span>
                                        <span className={`badge ${copy.isUnmanaged ? "warn" : ""}`}>
                                          {copy.manager ?? "unmanaged"}
                                        </span>
                                        {copy.differsFromGlobalManager && (
                                          <span
                                            className="badge warn"
                                            title="Managed by a different CLI than the global copy"
                                          >
                                            diff mgr
                                          </span>
                                        )}
                                        {copy.relativeToGlobal && (
                                          <span
                                            className={`badge ${
                                              copy.relativeToGlobal === "same"
                                                ? ""
                                                : copy.relativeToGlobal === "newer"
                                                  ? "ok"
                                                  : "warn"
                                            }`}
                                            title={`Relative to global copy: ${copy.relativeToGlobal}`}
                                          >
                                            {copy.relativeToGlobal === "same" ? (
                                              <Check size={10} aria-hidden="true" />
                                            ) : copy.relativeToGlobal === "newer" ? (
                                              <ArrowUp size={10} aria-hidden="true" />
                                            ) : copy.relativeToGlobal === "older" ? (
                                              <ArrowDown size={10} aria-hidden="true" />
                                            ) : (
                                              <GitCompare size={10} aria-hidden="true" />
                                            )}
                                            <span>{copy.relativeToGlobal}</span>
                                          </span>
                                        )}
                                        {copy.version && (
                                          <span className="badge">v{copy.version}</span>
                                        )}
                                        {copy.modifiedAt && (
                                          <span className="mono" style={{ color: "var(--muted)" }}>
                                            {new Date(copy.modifiedAt).toLocaleDateString()}
                                          </span>
                                        )}
                                        {copy.contentHash && (
                                          <span className="mono" style={{ color: "var(--muted)" }}>
                                            #{copy.contentHash.slice(0, 8)}
                                          </span>
                                        )}
                                      </span>
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 8,
                                          minWidth: 0,
                                        }}
                                      >
                                        <CopyableText text={copy.path} maxWidth={280} />
                                        {canRemoveScope && (
                                          <button
                                            type="button"
                                            className="btn danger"
                                            style={{ padding: "2px 6px", fontSize: 10 }}
                                            onClick={() =>
                                              void openRemoveExposurePreview(
                                                selectedSkill,
                                                copy.path,
                                              )
                                            }
                                          >
                                            <Trash2 size={10} aria-hidden="true" />
                                            <span>Remove Scope</span>
                                          </button>
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                        </div>
                      )}

                      <div>
                        <div className="nav-group-label" style={{ padding: 0 }}>
                          Exposures ({selectedSkill.exposures.length})
                        </div>
                        <div className="harness-badges" style={{ maxWidth: "100%" }}>
                          {selectedSkill.exposures.map((exp, i) => {
                            const scopeLabel = exp.scope === "global" ? "user" : "project";
                            const linkLabel =
                              exp.linkType === "physical-copy"
                                ? "physical copy"
                                : exp.linkType === "symlink-broken"
                                  ? "broken symlink"
                                  : "symlink";
                            const tooltip = `${exp.harnessId} · ${scopeLabel}${exp.profile ? ` (${exp.profile})` : ""} · ${linkLabel}`;
                            return (
                              <span
                                key={i}
                                title={tooltip}
                                className={`badge ${
                                  exp.linkType === "symlink-broken" ? "danger" : ""
                                }`}
                              >
                                <HarnessIcon harnessId={exp.harnessId} size={11} />
                                {exp.scope === "global" ? (
                                  <Globe size={10} aria-hidden="true" />
                                ) : (
                                  <FolderGit2 size={10} aria-hidden="true" />
                                )}
                                <LinkTypeIcon linkType={exp.linkType} size={10} />
                                {exp.profile && <span>{exp.profile}</span>}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {selectedSkill.projectPaths.length > 0 && (
                        <div>
                          <div className="nav-group-label" style={{ padding: 0 }}>
                            Projects ({selectedSkill.projectCount})
                          </div>
                          {selectedSkill.projectPaths.map((p) => (
                            <div key={p} style={{ marginTop: 2 }}>
                              <CopyableText text={p} maxWidth="100%" />
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void openUpgradePreview("skill", selectedSkill.id)}
                        >
                          <ArrowUpCircle size={12} aria-hidden="true" />
                          <span>Upgrade</span>
                        </button>
                        {selectedSkill.provenance.owningManager !== "apm" && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void openMigratePreview([selectedSkill.id])}
                          >
                            <span>Migrate to APM</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn danger"
                          onClick={() => void openRemovePreview(selectedSkill)}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div>
                      {contentLoading && <div className="skeleton-row" />}
                      {!contentLoading && skillContent && (
                        <>
                          <div style={{ marginBottom: 8, fontSize: 11 }}>
                            <CopyableText text={skillContent.skillFilePath} maxWidth="100%" />
                          </div>
                          <MarkdownViewer
                            content={skillContent.bodyRaw || skillContent.rawContent}
                          />
                        </>
                      )}
                      {!contentLoading && !skillContent && (
                        <div style={{ color: "var(--muted)" }}>
                          Could not load SKILL.md content for this skill.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </dialog>

            {filteredSkills.length > PAGE_SIZE && (
              <div className="pagination-bar">
                <span className="mono" style={{ color: "var(--muted)" }}>
                  {showAll
                    ? `Showing all ${filteredSkills.length} skills`
                    : `Showing ${safePage * PAGE_SIZE + 1}–${Math.min(
                        (safePage + 1) * PAGE_SIZE,
                        filteredSkills.length,
                      )} of ${filteredSkills.length}`}
                </span>
                <div className="toolbar">
                  {!showAll && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={safePage === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={safePage >= pageCount - 1}
                        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      >
                        Next
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={showAll}
                    onClick={() => setShowAll((s) => !s)}
                  >
                    {showAll ? "Paginate (50)" : "Show All"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {view === "discover" && (
          <>
            <form
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                setDiscoverMode("search");
                void loadDiscover(discoverQuery, "search");
              }}
            >
              <label htmlFor={discoverSearchId} className="visually-hidden">
                Search skills.sh or npx skills
              </label>
              <input
                id={discoverSearchId}
                type="search"
                placeholder="Search skills.sh or npx skills (e.g. react, postgres, ui)..."
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                style={{ minWidth: 300 }}
              />
              <button type="submit" className="btn primary" disabled={discoverLoading}>
                <Search size={12} aria-hidden="true" />
                <span>{discoverLoading ? "Searching..." : "Search"}</span>
              </button>
              <div className="underline-tabs" role="group" aria-label="Discover mode">
                <button
                  type="button"
                  className="underline-tab"
                  aria-pressed={discoverMode === "trending"}
                  onClick={() => {
                    setDiscoverMode("trending");
                    void loadDiscover(discoverQuery, "trending");
                  }}
                >
                  <Flame size={13} aria-hidden="true" />
                  <span>Trending</span>
                </button>
                <button
                  type="button"
                  className="underline-tab"
                  aria-pressed={discoverMode === "search"}
                  onClick={() => {
                    setDiscoverMode("search");
                    void loadDiscover(discoverQuery, "search");
                  }}
                >
                  <Search size={13} aria-hidden="true" />
                  <span>Search</span>
                </button>
              </div>
            </form>

            {discoverLoading && !discoverData && (
              <div className="panel" aria-busy="true" aria-label="Loading discover catalog">
                <div className="skeleton-row" />
                <div className="skeleton-row" />
                <div className="skeleton-row" />
              </div>
            )}

            {discoverData && discoverData.skills.length === 0 && (
              <div className="panel empty-state">
                <div>No skills found for "{discoverQuery || "agent"}".</div>
              </div>
            )}

            {discoverData && discoverData.skills.length > 0 && (
              <div className="discover-grid">
                {discoverData.skills.map((item) => (
                  <article key={item.id} className="discover-card">
                    <div className="discover-card-head">
                      <div>
                        <strong style={{ fontSize: 13.5 }}>{item.name}</strong>
                        <div className="mono" style={{ color: "var(--muted)" }}>
                          @{item.source}
                        </div>
                      </div>
                      {item.isInstalled ? (
                        <span className="badge ok">
                          <Check size={11} aria-hidden="true" />
                          <span>Installed</span>
                        </span>
                      ) : (
                        <span className="badge">
                          {item.installs > 0
                            ? `${item.installs.toLocaleString()} installs`
                            : "available"}
                        </span>
                      )}
                    </div>

                    <div className="discover-card-foot">
                      <a
                        href={item.skillsShUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn"
                        style={{ textDecoration: "none" }}
                      >
                        <span>skills.sh</span>
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => {
                          setInstallTarget(item);
                          setInstallManager("npx-skills");
                          setInstallScope("global");
                        }}
                      >
                        <Plus size={12} aria-hidden="true" />
                        <span>Install</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {view === "primitives" && (
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            <div className="underline-tabs" role="tablist" aria-label="Primitive categories">
              {(
                [
                  { id: "mcp", label: `MCP Servers (${primitivesData?.mcpServers.length ?? 0})` },
                  { id: "command", label: `Commands (${primitivesData?.commands.length ?? 0})` },
                  { id: "prompt", label: `Prompts (${primitivesData?.prompts.length ?? 0})` },
                  { id: "hook", label: `Hooks (${primitivesData?.hooks.length ?? 0})` },
                  { id: "lsp", label: `LSPs (${primitivesData?.lsps.length ?? 0})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  className="underline-tab"
                  aria-selected={primitiveTab === t.id}
                  onClick={() => setPrimitiveTab(t.id)}
                >
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {!primitivesData ? (
              <div className="panel" aria-busy="true">
                <div className="skeleton-row" />
                <div className="skeleton-row" />
              </div>
            ) : primitiveTab === "mcp" ? (
              (() => {
                const matrixHarnesses = Array.from(
                  new Set(primitivesData.mcpServers.flatMap((m) => m.harnesses)),
                ).sort();
                return primitivesData.mcpServers.length === 0 ? (
                  <div className="panel empty-state">No MCP servers configured.</div>
                ) : (
                  <div className="table-wrapper" tabIndex={0}>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">MCP Server</th>
                          <th scope="col">Transport</th>
                          <th scope="col">Command / Endpoint</th>
                          {matrixHarnesses.map((hId) => (
                            <th key={hId} scope="col" title={hId}>
                              <span
                                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                              >
                                <HarnessIcon harnessId={hId} size={12} />
                                <span>{hId}</span>
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {primitivesData.mcpServers.map((mcp) => (
                          <tr key={mcp.name}>
                            <td>
                              <strong>{mcp.name}</strong>
                            </td>
                            <td>
                              <span className="badge">{mcp.transport}</span>
                            </td>
                            <td>
                              <CopyableText text={mcp.commandOrUrl} maxWidth={320} />
                            </td>
                            {matrixHarnesses.map((hId) => {
                              const enabled = mcp.harnesses.includes(hId);
                              return (
                                <td key={hId}>
                                  {enabled ? (
                                    <span className="badge ok" title={`Configured in ${hId}`}>
                                      <Check size={11} aria-hidden="true" />
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--muted)" }}>—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()
            ) : (
              (() => {
                const list =
                  primitiveTab === "command"
                    ? primitivesData.commands
                    : primitiveTab === "prompt"
                      ? primitivesData.prompts
                      : primitiveTab === "hook"
                        ? primitivesData.hooks
                        : primitivesData.lsps;
                return list.length === 0 ? (
                  <div className="panel empty-state">No {primitiveTab}s discovered.</div>
                ) : (
                  <div className="table-wrapper" tabIndex={0}>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Harness</th>
                          <th scope="col">Detail</th>
                          <th scope="col">Path</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.name}</strong>
                            </td>
                            <td>
                              <span
                                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                              >
                                <HarnessIcon harnessId={item.harnessId} size={12} />
                                <span>{item.harnessId}</span>
                              </span>
                            </td>
                            <td style={{ color: "var(--muted)" }}>{item.detail ?? "—"}</td>
                            <td>
                              <CopyableText text={item.path} maxWidth={400} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {view === "sessions" && (
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            {selectedSessionDetail ? (
              <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
                <section className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}
                    >
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setSelectedSessionDetail(null)}
                      >
                        <ArrowLeft size={13} aria-hidden="true" />
                        <span>Sessions</span>
                      </button>
                      <HarnessIcon harnessId={selectedSessionDetail.harnessId} size={18} />
                      <h2
                        style={{
                          margin: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={selectedSessionDetail.title}
                      >
                        {selectedSessionDetail.title}
                      </h2>
                    </div>
                    <div className="toolbar">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(selectedSessionDetail.id);
                          setBanner(`Copied session ID: ${selectedSessionDetail.id}`);
                        }}
                      >
                        <Copy size={12} aria-hidden="true" />
                        <span>Copy ID</span>
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(selectedSessionDetail.transcriptPath);
                          setBanner("Copied transcript path.");
                        }}
                      >
                        <Copy size={12} aria-hidden="true" />
                        <span>Copy Path</span>
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => {
                          void client
                            .revealPath(selectedSessionDetail.transcriptPath)
                            .catch((err) =>
                              setBanner(
                                `Failed to open Finder: ${err instanceof Error ? err.message : String(err)}`,
                              ),
                            );
                        }}
                      >
                        <FolderOpen size={13} aria-hidden="true" />
                        <span>Open in Finder</span>
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      flexWrap: "wrap",
                      fontSize: 12.5,
                      color: "var(--muted)",
                    }}
                  >
                    {selectedSessionDetail.projectFolder && (
                      <CopyableText text={selectedSessionDetail.projectFolder} maxWidth={340} />
                    )}
                    <span>{new Date(selectedSessionDetail.updatedAt).toLocaleString()}</span>
                    <span className="badge">{selectedSessionDetail.promptCount} prompts</span>
                    {selectedSessionDetail.model && (
                      <span className="badge">{selectedSessionDetail.model}</span>
                    )}
                    <span className="mono">
                      {selectedSessionDetail.totalTokens.toLocaleString()} tokens
                    </span>
                    <span className="badge ok">
                      ${selectedSessionDetail.estimatedCostUsd.toFixed(4)}
                    </span>
                  </div>
                </section>

                <section className="chat-stream" aria-label="Session conversation">
                  {selectedSessionDetail.messages.length === 0 ? (
                    <div className="panel empty-state">
                      No readable conversation messages in this transcript.
                    </div>
                  ) : (
                    selectedSessionDetail.messages.map((m, idx) => (
                      <article
                        key={`${m.role}-${idx}`}
                        className={`chat-turn ${m.role === "user" ? "user" : "assistant"}`}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            fontSize: 12,
                            color: "var(--muted)",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {m.role === "assistant" && (
                              <HarnessIcon harnessId={selectedSessionDetail.harnessId} size={13} />
                            )}
                            <strong style={{ color: "var(--text)" }}>
                              {m.role === "user" ? "You" : selectedSessionDetail.harnessId}
                            </strong>
                            {m.timestamp && <span>{new Date(m.timestamp).toLocaleString()}</span>}
                            {m.model && <span className="badge">{m.model}</span>}
                          </span>
                          {m.tokens !== undefined && (
                            <span className="mono">{m.tokens.toLocaleString()} tokens</span>
                          )}
                        </div>
                        <MarkdownViewer content={m.content} />
                      </article>
                    ))
                  )}
                </section>
              </div>
            ) : (
              <>
                <div className="filter-panel">
                  <div className="filter-row">
                    <div className="filter-group" style={{ flex: 1 }}>
                      <input
                        type="search"
                        aria-label="Search sessions"
                        placeholder="Search titles, folders, or session IDs..."
                        value={sessionSearch}
                        onChange={(e) => setSessionSearch(e.target.value)}
                        style={{ minWidth: 260, flex: "1 1 260px", maxWidth: 420 }}
                      />
                      <select
                        aria-label="Filter sessions by harness"
                        value={sessionHarnessFilter}
                        onChange={(e) => setSessionHarnessFilter(e.target.value)}
                      >
                        <option value="all">All Harnesses</option>
                        {Array.from(new Set(sessionsData.map((s) => s.harnessId)))
                          .sort()
                          .map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="filter-group">
                      <span className="filter-group-label">Sort</span>
                      <select
                        aria-label="Sort sessions"
                        value={sessionSortBy}
                        onChange={(e) =>
                          setSessionSortBy(
                            e.target.value as "newest" | "oldest" | "title" | "messages",
                          )
                        }
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="title">Title (A–Z)</option>
                        <option value="messages">Most messages</option>
                      </select>
                      <span className="filter-group-label">Group</span>
                      <div className="chip-group" role="group" aria-label="Group sessions">
                        <button
                          type="button"
                          className={`btn ${sessionGroupBy === "time" ? "active-chip" : ""}`}
                          onClick={() => setSessionGroupBy("time")}
                        >
                          By time
                        </button>
                        <button
                          type="button"
                          className={`btn ${sessionGroupBy === "project" ? "active-chip" : ""}`}
                          onClick={() => setSessionGroupBy("project")}
                        >
                          By project
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {sessionDetailLoading && (
                  <div className="panel" aria-busy="true">
                    <div className="skeleton-row" />
                  </div>
                )}

                {(() => {
                  const filteredSessions = sessionsData
                    .filter((s) => {
                      if (sessionHarnessFilter !== "all" && s.harnessId !== sessionHarnessFilter) {
                        return false;
                      }
                      const q = sessionSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        s.title.toLowerCase().includes(q) ||
                        (s.projectFolder?.toLowerCase().includes(q) ?? false) ||
                        (s.model?.toLowerCase().includes(q) ?? false) ||
                        s.id.toLowerCase().includes(q)
                      );
                    })
                    .sort((a, b) => {
                      switch (sessionSortBy) {
                        case "oldest":
                          return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
                        case "title":
                          return a.title.localeCompare(b.title);
                        case "messages":
                          return b.messageCount - a.messageCount;
                        case "newest":
                        default:
                          return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
                      }
                    });
                  if (filteredSessions.length === 0) {
                    return <div className="panel empty-state">No sessions found.</div>;
                  }
                  const startOfToday = new Date();
                  startOfToday.setHours(0, 0, 0, 0);
                  const todayMs = startOfToday.getTime();
                  const yesterdayMs = todayMs - 86_400_000;
                  const weekMs = todayMs - 7 * 86_400_000;
                  const groups = new Map<string, SessionSummary[]>();
                  for (const s of filteredSessions) {
                    let key = "Earlier";
                    if (sessionGroupBy === "project") {
                      key = s.projectFolder ?? "Unknown workspace";
                    } else {
                      const t = Date.parse(s.updatedAt);
                      key =
                        t >= todayMs
                          ? "Today"
                          : t >= yesterdayMs
                            ? "Yesterday"
                            : t >= weekMs
                              ? "This week"
                              : "Earlier";
                    }
                    const list = groups.get(key) ?? [];
                    list.push(s);
                    groups.set(key, list);
                  }
                  return Array.from(groups.entries()).map(([groupLabel, items]) => (
                    <section key={groupLabel} style={{ display: "grid", gap: 8 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0 4px",
                        }}
                      >
                        <span className="filter-group-label">{groupLabel}</span>
                        <span className="count-pill">{items.length}</span>
                      </div>
                      <div className="session-list">
                        {items.map((s) => (
                          <div
                            key={s.id}
                            className="session-row"
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSessionDetailLoading(true);
                              void client
                                .getSessionDetail(s.transcriptPath, s.harnessId)
                                .then(setSelectedSessionDetail)
                                .finally(() => setSessionDetailLoading(false));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSessionDetailLoading(true);
                                void client
                                  .getSessionDetail(s.transcriptPath, s.harnessId)
                                  .then(setSelectedSessionDetail)
                                  .finally(() => setSessionDetailLoading(false));
                              }
                            }}
                          >
                            <div className="session-row-main">
                              <span style={{ marginTop: 2, flexShrink: 0 }}>
                                <HarnessIcon harnessId={s.harnessId} size={16} />
                              </span>
                              <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                                <strong
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {s.title}
                                </strong>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    flexWrap: "wrap",
                                    color: "var(--muted)",
                                    fontSize: 12,
                                  }}
                                >
                                  {s.projectFolder && (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                      title={s.projectFolder}
                                    >
                                      <FolderGit2 size={11} aria-hidden="true" />
                                      <span>{s.projectFolder.split("/").pop()}</span>
                                    </span>
                                  )}
                                  <span className="mono">{s.id.slice(0, 8)}</span>
                                  {s.model && <span className="badge">{s.model}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="session-row-meta" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="icon-ghost-btn"
                                title={`Copy session ID: ${s.id}`}
                                aria-label={`Copy session ID ${s.id}`}
                                onClick={() => {
                                  void navigator.clipboard.writeText(s.id);
                                  setBanner(`Copied session ID: ${s.id}`);
                                }}
                              >
                                <Copy size={13} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="icon-ghost-btn"
                                title={`Open in Finder: ${s.transcriptPath}`}
                                aria-label={`Open in Finder: ${s.transcriptPath}`}
                                onClick={() => void client.revealPath(s.transcriptPath)}
                              >
                                <FolderOpen size={13} aria-hidden="true" />
                              </button>
                              <span
                                className="mono"
                                style={{ color: "var(--muted)", minWidth: 74, textAlign: "right" }}
                                title={new Date(s.updatedAt).toLocaleString()}
                              >
                                {formatRelativeTime(s.updatedAt)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ));
                })()}
              </>
            )}
          </div>
        )}

        {view === "tokens" && data && (
          <>
            <div className="underline-tabs" role="tablist" aria-label="Token usage views">
              <button
                type="button"
                role="tab"
                className="underline-tab"
                aria-selected={tokensTab === "budgets"}
                onClick={() => setTokensTab("budgets")}
              >
                <Layers size={13} aria-hidden="true" />
                <span>Skill Token Budgets</span>
              </button>
              <button
                type="button"
                role="tab"
                className="underline-tab"
                aria-selected={tokensTab === "requests"}
                onClick={() => setTokensTab("requests")}
              >
                <Cpu size={13} aria-hidden="true" />
                <span>Request &amp; Model Usage</span>
              </button>
            </div>

            {tokensTab === "requests" ? (
              !usageMetricsData ? (
                <div className="panel" aria-busy="true">
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                </div>
              ) : (
                <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
                  <section className="stats-strip" aria-label="Session request usage summary">
                    <div className="stat-tile">
                      <div className="stat-label">Estimated Cost</div>
                      <div className="stat-value">
                        ${usageMetricsData.estimatedCostUsd.toFixed(2)}
                      </div>
                    </div>
                    <div className="stat-tile">
                      <div className="stat-label">Total Requests</div>
                      <div className="stat-value">
                        {usageMetricsData.totalRequests.toLocaleString()}
                      </div>
                    </div>
                    <div className="stat-tile">
                      <div className="stat-label">Tokens Processed</div>
                      <div className="stat-value">
                        {usageMetricsData.totalTokensProcessed.toLocaleString()}
                      </div>
                    </div>
                    <div className="stat-tile">
                      <div className="stat-label">Cache Hit Rate</div>
                      <div className="stat-value">{usageMetricsData.cacheHitRatePct}%</div>
                    </div>
                  </section>

                  <section className="panel" style={{ display: "grid", gap: 10 }}>
                    <h2 style={{ margin: 0 }}>Tokens (Hourly Distribution)</h2>
                    {(() => {
                      const maxTokens = Math.max(
                        1,
                        ...usageMetricsData.hourly.map((h) => h.tokens),
                      );
                      return (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(24, minmax(10px, 1fr))",
                            alignItems: "end",
                            gap: 4,
                            height: 110,
                            paddingTop: 8,
                          }}
                        >
                          {usageMetricsData.hourly.map((h) => {
                            const pct = Math.max(4, Math.round((h.tokens / maxTokens) * 100));
                            return (
                              <div
                                key={h.hour}
                                title={`${h.hour}: ${h.tokens.toLocaleString()} tokens (${h.requests} reqs)`}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  height: "100%",
                                  justifyContent: "flex-end",
                                  gap: 4,
                                }}
                              >
                                <div
                                  style={{
                                    width: "100%",
                                    height: `${h.tokens > 0 ? pct : 3}%`,
                                    background:
                                      h.tokens > 0 ? "var(--accent-fill)" : "var(--border)",
                                    borderRadius: 3,
                                  }}
                                />
                                <span style={{ fontSize: 9, color: "var(--muted)" }}>
                                  {h.hour.slice(0, 2)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </section>

                  <section className="panel" style={{ display: "grid", gap: 8 }}>
                    <h2 style={{ margin: 0 }}>By Model</h2>
                    <div className="table-wrapper" tabIndex={0}>
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Model</th>
                            <th scope="col">Requests</th>
                            <th scope="col">Input</th>
                            <th scope="col">Output</th>
                            <th scope="col">Cache Hit</th>
                            <th scope="col">Est. Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageMetricsData.byModel.map((m) => (
                            <tr key={m.model}>
                              <td>
                                <strong>{m.model}</strong>
                              </td>
                              <td className="mono num">{m.requests.toLocaleString()}</td>
                              <td className="mono num">{m.inputTokens.toLocaleString()}</td>
                              <td className="mono num">{m.outputTokens.toLocaleString()}</td>
                              <td className="mono num">{m.cacheReadTokens.toLocaleString()}</td>
                              <td className="mono num">${m.estimatedCostUsd.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="panel" style={{ display: "grid", gap: 8 }}>
                    <h2 style={{ margin: 0 }}>
                      Recent Request Logs ({usageMetricsData.recentRequests.length})
                    </h2>
                    <div className="table-wrapper" tabIndex={0}>
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Time</th>
                            <th scope="col">Harness</th>
                            <th scope="col">Model</th>
                            <th scope="col">Cost</th>
                            <th scope="col">Input</th>
                            <th scope="col">Output</th>
                            <th scope="col">Cache Hit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageMetricsData.recentRequests.map((r, idx) => (
                            <tr key={`${r.timestamp}-${idx}`}>
                              <td className="mono" style={{ color: "var(--muted)" }}>
                                {new Date(r.timestamp).toLocaleTimeString()}
                              </td>
                              <td>
                                <span
                                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                                >
                                  <HarnessIcon harnessId={r.harnessId} size={12} />
                                  <span>{r.harnessId}</span>
                                </span>
                              </td>
                              <td>
                                <span className="badge">{r.model}</span>
                              </td>
                              <td className="mono num">${r.estimatedCostUsd.toFixed(4)}</td>
                              <td className="mono num">{r.inputTokens.toLocaleString()}</td>
                              <td className="mono num">{r.outputTokens.toLocaleString()}</td>
                              <td className="mono num">{r.cacheReadTokens.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )
            ) : (
              <>
                <div className="toolbar">
                  <input
                    type="search"
                    aria-label="Filter harnesses, authors, or projects"
                    placeholder="Filter harnesses, authors, or projects..."
                    value={tokensSearch}
                    onChange={(e) => setTokensSearch(e.target.value)}
                    style={{ minWidth: 280 }}
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 14,
                    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
                  }}
                >
                  <section className="panel">
                    <h2>By Harness (Always-On Description Tokens)</h2>
                    <div
                      className="table-wrapper"
                      tabIndex={0}
                      role="region"
                      aria-label="Tokens by harness"
                    >
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Harness</th>
                            <th scope="col">Skills</th>
                            <th scope="col">Desc Tokens</th>
                            <th scope="col">Full Tokens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.telemetry.byHarness
                            .filter(
                              (h) =>
                                !tokensSearch.trim() ||
                                h.harnessId.toLowerCase().includes(tokensSearch.toLowerCase()),
                            )
                            .map((h) => (
                              <tr key={h.harnessId}>
                                <td>{h.harnessId}</td>
                                <td className="mono">{h.skillCount}</td>
                                <td className="mono">
                                  {h.tokens.descriptionTokens.toLocaleString()}
                                </td>
                                <td className="mono">{h.tokens.fullTokens.toLocaleString()}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="panel">
                    <h2>By Source (Sorted by Full Tokens)</h2>
                    <div
                      className="table-wrapper"
                      tabIndex={0}
                      role="region"
                      aria-label="Tokens by source"
                    >
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Source</th>
                            <th scope="col">Skills</th>
                            <th scope="col">Desc Tokens</th>
                            <th scope="col">Full Tokens</th>
                            <th scope="col">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.telemetry.byAuthor
                            .filter(
                              (a) =>
                                !tokensSearch.trim() ||
                                a.author.toLowerCase().includes(tokensSearch.toLowerCase()),
                            )
                            .map((a) => (
                              <tr key={a.author}>
                                <td>
                                  <span
                                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                                  >
                                    <SourceIcon
                                      manager={
                                        a.sourceRepo?.includes("github.com")
                                          ? "npx-skills"
                                          : "manual"
                                      }
                                      sourceRepo={a.sourceRepo}
                                      sourceName={a.author}
                                    />
                                    <span>{a.author}</span>
                                  </span>
                                </td>
                                <td className="mono">{a.skillCount}</td>
                                <td className="mono">
                                  {a.tokens.descriptionTokens.toLocaleString()}
                                </td>
                                <td className="mono">{a.tokens.fullTokens.toLocaleString()}</td>
                                <td>
                                  <div className="toolbar">
                                    <button
                                      type="button"
                                      className="btn"
                                      aria-label={`Upgrade all skills from ${a.author}`}
                                      onClick={() => void openUpgradePreview("author", a.author)}
                                    >
                                      <ArrowUpCircle size={12} aria-hidden="true" />
                                      <span>Upgrade</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="btn danger"
                                      aria-label={`Remove all skills from ${a.author}`}
                                      onClick={() => void openRemoveSourcePreview(a.author)}
                                    >
                                      <Trash2 size={12} aria-hidden="true" />
                                      <span>Remove</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="panel" style={{ gridColumn: "1 / -1" }}>
                    <h2>Heaviest Projects by Token Usage</h2>
                    {data.telemetry.byProject.length === 0 ? (
                      <div className="empty-state">No project-level skills discovered.</div>
                    ) : (
                      <div
                        className="table-wrapper"
                        tabIndex={0}
                        role="region"
                        aria-label="Tokens by project"
                      >
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Project</th>
                              <th scope="col">Skills</th>
                              <th scope="col">Desc Tokens</th>
                              <th scope="col">Full Tokens</th>
                              <th scope="col">Harnesses</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.telemetry.byProject
                              .filter(
                                (p) =>
                                  !tokensSearch.trim() ||
                                  p.projectRoot.toLowerCase().includes(tokensSearch.toLowerCase()),
                              )
                              .map((p) => (
                                <tr key={p.projectRoot}>
                                  <td className="mono">{p.projectRoot}</td>
                                  <td className="mono">{p.skillCount}</td>
                                  <td className="mono">
                                    {p.tokens.descriptionTokens.toLocaleString()}
                                  </td>
                                  <td className="mono">{p.tokens.fullTokens.toLocaleString()}</td>
                                  <td>
                                    <div className="harness-icons-row">
                                      {p.harnesses.slice(0, 6).map((h) => (
                                        <span key={h} className="harness-icon-chip" title={h}>
                                          <HarnessIcon harnessId={h} size={12} />
                                        </span>
                                      ))}
                                      {p.harnesses.length > 6 && (
                                        <span className="badge">+{p.harnesses.length - 6}</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </>
        )}

        {view === "projects" && data && (
          <section className="panel">
            <div className="topbar" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Cross-Project Aggregation & Drift</h2>
              <div className="toolbar">
                <input
                  type="search"
                  aria-label="Filter skills or project paths"
                  placeholder="Search skills or project paths..."
                  value={projectsSearch}
                  onChange={(e) => setProjectsSearch(e.target.value)}
                  style={{ minWidth: 240 }}
                />
                <div className="chip-group" role="group" aria-label="Drift filter">
                  {(
                    [
                      { id: "all", label: "All", icon: Layers },
                      { id: "drifted", label: "Drifted", icon: GitCompare },
                      { id: "sync", label: "In Sync", icon: CheckCircle2 },
                    ] as const
                  ).map((f) => {
                    const Icon = f.icon;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`btn ${projectsDriftFilter === f.id ? "active-chip" : ""}`}
                        aria-pressed={projectsDriftFilter === f.id}
                        onClick={() => setProjectsDriftFilter(f.id)}
                      >
                        <Icon size={12} aria-hidden="true" />
                        <span>{f.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {data.snapshot.skills.filter((s) => s.projectCount > 0).length === 0 ? (
              <div className="empty-state">
                No project-level skills discovered in configured workspace roots.
              </div>
            ) : (
              <div
                className="table-wrapper"
                tabIndex={0}
                role="region"
                aria-label="Projects and drift"
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Skill</th>
                      <th scope="col">Project Count</th>
                      <th scope="col">Drift</th>
                      <th scope="col">Project Paths</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.snapshot.skills
                      .filter((s) => {
                        if (s.projectCount === 0) return false;
                        if (projectsDriftFilter === "drifted" && !s.hasDrift) return false;
                        if (projectsDriftFilter === "sync" && s.hasDrift) return false;
                        if (!projectsSearch.trim()) return true;
                        const q = projectsSearch.toLowerCase();
                        return (
                          s.name.toLowerCase().includes(q) ||
                          s.projectPaths.some((p) => p.toLowerCase().includes(q))
                        );
                      })
                      .map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td className="mono">{s.projectCount}</td>
                          <td>
                            {s.hasDrift ? (
                              <span className="badge warn">Differs from global</span>
                            ) : (
                              <span className="badge ok">In sync</span>
                            )}
                          </td>
                          <td className="mono">
                            {s.projectPaths.map((p) => (
                              <div key={p}>{p}</div>
                            ))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {view === "sources" && data && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="toolbar">
              <input
                type="search"
                aria-label="Search sources, repos, or skills"
                placeholder="Search sources, repos, or skills..."
                value={sourcesSearch}
                onChange={(e) => setSourcesSearch(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <div className="chip-group" role="group" aria-label="Source status filter">
                {(
                  [
                    { id: "all", label: "All Sources", icon: Package },
                    { id: "available", label: "Has Available", icon: Plus },
                    { id: "deprecated", label: "Has Deprecated", icon: AlertTriangle },
                  ] as const
                ).map((f) => {
                  const Icon = f.icon;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className={`btn ${sourcesFilter === f.id ? "active-chip" : ""}`}
                      aria-pressed={sourcesFilter === f.id}
                      onClick={() => setSourcesFilter(f.id)}
                    >
                      <Icon size={12} aria-hidden="true" />
                      <span>{f.label}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setExpandedSources(new Set(data.sources.map((s) => s.sourceId)))}
              >
                Expand All
              </button>
              <button type="button" className="btn" onClick={() => setExpandedSources(new Set())}>
                Collapse All
              </button>
            </div>

            {data.sources
              .filter((src) => {
                if (sourcesFilter === "available" && src.availableCount === 0) return false;
                if (sourcesFilter === "deprecated" && src.deprecatedCount === 0) return false;
                if (!sourcesSearch.trim()) return true;
                const q = sourcesSearch.toLowerCase();
                return (
                  src.author.toLowerCase().includes(q) ||
                  (src.sourceRepo ?? "").toLowerCase().includes(q) ||
                  (src.marketplaceName ?? "").toLowerCase().includes(q) ||
                  src.skills.some((sk) => sk.name.toLowerCase().includes(q))
                );
              })
              .map((src) => {
                const isOpen = expandedSources.has(src.sourceId);
                return (
                  <section key={src.sourceId} className="panel">
                    <button
                      type="button"
                      className="source-group-toggle"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setExpandedSources((prev) => {
                          const next = new Set(prev);
                          if (next.has(src.sourceId)) next.delete(src.sourceId);
                          else next.add(src.sourceId);
                          return next;
                        })
                      }
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isOpen ? (
                          <ChevronDown size={14} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={14} aria-hidden="true" />
                        )}
                        <h2 style={{ margin: 0 }}>
                          {src.marketplaceName ?? src.sourceRepo ?? src.author}{" "}
                          <span className="badge">{src.owningManager}</span>
                        </h2>
                      </div>
                      <div className="mono">
                        <span className="badge ok">installed: {src.installedCount}</span>
                        <span className="badge">available: {src.availableCount}</span>
                        {src.deprecatedCount > 0 && (
                          <span className="badge warn">deprecated: {src.deprecatedCount}</span>
                        )}
                      </div>
                    </button>
                    {isOpen && (
                      <div
                        className="table-wrapper"
                        tabIndex={0}
                        role="region"
                        aria-label={`Skills from ${src.author}`}
                        style={{ marginTop: 10 }}
                      >
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Skill</th>
                              <th scope="col">Status</th>
                              <th scope="col">Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {src.skills.map((sk) => (
                              <tr key={sk.name}>
                                <td>
                                  <strong>{sk.name}</strong>
                                  {sk.pathInSource && (
                                    <div className="mono" style={{ color: "var(--muted)" }}>
                                      {sk.pathInSource}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <span
                                    className={`badge ${
                                      sk.lifecycle === "installed"
                                        ? "ok"
                                        : sk.lifecycle === "deprecated"
                                          ? "warn"
                                          : ""
                                    }`}
                                  >
                                    {sk.lifecycle}
                                  </span>
                                </td>
                                <td>
                                  {sk.deprecationReason && (
                                    <span className="badge warn">{sk.deprecationReason}</span>
                                  )}
                                  {sk.replacedBy && (
                                    <span className="mono">Replaced by: {sk.replacedBy}</span>
                                  )}
                                  {!sk.deprecationReason && !sk.replacedBy && (
                                    <span style={{ color: "var(--muted)" }}>
                                      {sk.description ?? ""}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                );
              })}
          </div>
        )}

        {view === "cleanup" && data && (
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            <section
              className="panel"
              style={{
                padding: 14,
                display: "grid",
                gap: 10,
                borderColor: "var(--accent)",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <h2 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={16} aria-hidden="true" />
                    <span>Cleanup Queue &amp; Expected Impact</span>
                  </h2>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {cleanupPreview ? (
                      <>
                        <strong>{cleanupPreview.impact.removeCount}</strong> to remove ·{" "}
                        <strong>{cleanupPreview.impact.byCategorySelected.duplicates}</strong>{" "}
                        duplicates ·{" "}
                        <strong>{cleanupPreview.impact.byCategorySelected.drift}</strong> drift ·{" "}
                        <strong>{cleanupPreview.impact.byCategorySelected.unused}</strong> unused ·{" "}
                        <strong>{cleanupPreview.impact.byCategorySelected.untracked}</strong>{" "}
                        untracked ·{" "}
                        <strong style={{ color: "var(--ok)" }}>
                          -{cleanupPreview.impact.tokensSavedDesc.toLocaleString()} desc (-
                          {cleanupPreview.impact.tokensSavedDescPct}%)
                        </strong>{" "}
                        /{" "}
                        <strong style={{ color: "var(--ok)" }}>
                          -{cleanupPreview.impact.tokensSavedFull.toLocaleString()} full (-
                          {cleanupPreview.impact.tokensSavedFullPct}%)
                        </strong>
                      </>
                    ) : (
                      "Select candidates below to compute expected token savings and manager CLI queue."
                    )}
                  </div>
                </div>
                <div className="toolbar">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setCleanupDecisions((prev) => {
                        const next = { ...prev };
                        for (const key of Object.keys(next)) {
                          next[key] = { ...next[key]!, selected: false };
                        }
                        return next;
                      })
                    }
                  >
                    Clear Queue
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={
                      cleanupExecuting || !cleanupPreview || cleanupPreview.commands.length === 0
                    }
                    onClick={() => {
                      if (!cleanupPreview) return;
                      setPreviewModal({
                        preview: {
                          action: "remove",
                          summary: cleanupPreview.summary,
                          targetSkillIds: cleanupQueue.map((q) => q.skillId),
                          commands: cleanupPreview.commands,
                          pathChanges: cleanupPreview.pathChanges,
                          warnings: cleanupPreview.warnings,
                        },
                        execute: async () => {
                          setCleanupExecuting(true);
                          try {
                            const res = await client.executeCleanup(cleanupQueue);
                            return {
                              action: "remove",
                              success: res.success,
                              preview: {
                                action: "remove",
                                summary: res.preview.summary,
                                targetSkillIds: cleanupQueue.map((q) => q.skillId),
                                commands: res.preview.commands,
                                pathChanges: res.preview.pathChanges,
                                warnings: res.preview.warnings,
                              },
                              executedCommands: res.executedCommands,
                              errors: res.errors,
                            };
                          } finally {
                            setCleanupExecuting(false);
                          }
                        },
                      });
                    }}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                    <span>
                      Execute Queue ({cleanupPreview?.commands.length ?? 0} cmd
                      {cleanupPreview?.commands.length === 1 ? "" : "s"})
                    </span>
                  </button>
                </div>
              </div>

              {cleanupPreview && cleanupPreview.commands.length > 0 && (
                <pre style={{ maxHeight: 140, overflow: "auto", maxWidth: "100%" }}>
                  {cleanupPreview.commands
                    .map(
                      (c) => `$ ${c.command} ${c.args.join(" ")}${c.cwd ? ` (cwd: ${c.cwd})` : ""}`,
                    )
                    .join("\n")}
                </pre>
              )}
              {cleanupPreview && cleanupPreview.warnings.length > 0 && (
                <div
                  className="badge warn"
                  style={{ whiteSpace: "normal", wordBreak: "break-word" }}
                >
                  {cleanupPreview.warnings.slice(0, 3).join(" · ")}
                  {cleanupPreview.warnings.length > 3
                    ? ` (+${cleanupPreview.warnings.length - 3} more)`
                    : ""}
                </div>
              )}
            </section>

            {(
              [
                {
                  id: "duplicates",
                  label: "Duplicates",
                  icon: Copy,
                  desc: "Cross-skill duplicates (identical content/name) and multi-copy installations",
                },
                {
                  id: "drift",
                  label: "Drift & Conflicts",
                  icon: GitCompare,
                  desc: "Divergent content hashes, multiple managers, or unmanaged copies",
                },
                {
                  id: "unused",
                  label: "Unused",
                  icon: Clock,
                  desc: "Skills with 0 activations found in session transcripts",
                },
                {
                  id: "untracked",
                  label: "Untracked",
                  icon: AlertTriangle,
                  desc: "Manual or git-clone skills outside APM / npx-skills / plugin CLIs",
                },
                {
                  id: "broken",
                  label: "Broken Links",
                  icon: Link2Off,
                  desc: "Dangling symlinks whose target directory no longer exists",
                },
                {
                  id: "outdated",
                  label: "Outdated",
                  icon: Download,
                  desc: "Skills with upstream updates available via manager CLI",
                },
              ] as const
            ).map((cat) => {
              const items = cleanupCandidates.filter((c) => c.category === cat.id);
              const isCollapsed = collapsedCleanupCats.has(cat.id);
              const Icon = cat.icon;
              const selectedInCat = items.filter(
                (c) => cleanupDecisions[cleanupKey(c)]?.selected,
              ).length;
              return (
                <section key={cat.id} className="panel" style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      className="source-group-toggle"
                      style={{ flex: 1 }}
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsedCleanupCats((prev) => {
                          const next = new Set(prev);
                          if (next.has(cat.id)) next.delete(cat.id);
                          else next.add(cat.id);
                          return next;
                        })
                      }
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {isCollapsed ? (
                          <ChevronRight size={14} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={14} aria-hidden="true" />
                        )}
                        <Icon size={14} aria-hidden="true" />
                        <strong>{cat.label}</strong>
                        <span className="badge">
                          {selectedInCat}/{items.length}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>
                        {cat.desc}
                      </span>
                    </button>
                    {items.length > 0 && (
                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setCleanupDecisions((prev) => {
                              const next = { ...prev };
                              for (const c of items) {
                                const k = cleanupKey(c);
                                const cur = next[k] ?? {
                                  selected: false,
                                  action: c.recommendedAction,
                                  targetScope: c.recommendedScope,
                                };
                                next[k] = {
                                  ...cur,
                                  selected: cur.action !== "skip",
                                };
                              }
                              return next;
                            })
                          }
                        >
                          Select Actionable
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setCleanupDecisions((prev) => {
                              const next = { ...prev };
                              for (const c of items) {
                                const k = cleanupKey(c);
                                if (next[k]) next[k] = { ...next[k], selected: false };
                              }
                              return next;
                            })
                          }
                        >
                          Deselect
                        </button>
                      </div>
                    )}
                  </div>

                  {!isCollapsed && (
                    <div style={{ marginTop: 10 }}>
                      {items.length === 0 ? (
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>
                          No {cat.label.toLowerCase()} issues found.
                        </div>
                      ) : (
                        <div className="table-wrapper" tabIndex={0}>
                          <table>
                            <thead>
                              <tr>
                                <th scope="col" style={{ width: 32 }}>
                                  Use
                                </th>
                                <th scope="col">Skill</th>
                                <th scope="col">Reason</th>
                                <th scope="col">Manager</th>
                                <th scope="col">Tokens</th>
                                <th scope="col">Action</th>
                                <th scope="col">Scope</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((c) => {
                                const key = cleanupKey(c);
                                const dec = cleanupDecisions[key] ?? {
                                  selected: false,
                                  action: c.recommendedAction,
                                  targetScope: c.recommendedScope,
                                };
                                return (
                                  <tr key={key}>
                                    <td>
                                      <input
                                        type="checkbox"
                                        aria-label={`Select ${c.skillName} for ${cat.label}`}
                                        checked={dec.selected}
                                        onChange={(e) =>
                                          setCleanupDecisions((prev) => ({
                                            ...prev,
                                            [key]: { ...dec, selected: e.target.checked },
                                          }))
                                        }
                                      />
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className="text-link"
                                        style={{ fontWeight: 600 }}
                                        onClick={() => setSelectedSkillId(c.skillId)}
                                      >
                                        {c.skillName}
                                      </button>
                                    </td>
                                    <td style={{ fontSize: 12, color: "var(--muted)" }}>
                                      {c.reason}
                                    </td>
                                    <td>
                                      <span className="badge">{c.owningManager}</span>
                                    </td>
                                    <td className="mono num">
                                      {c.descriptionTokens} / {c.fullTokens}
                                    </td>
                                    <td>
                                      <select
                                        className="select"
                                        aria-label={`Action for ${c.skillName}`}
                                        value={dec.action}
                                        onChange={(e) => {
                                          const action = e.target.value as CleanupActionChoice;
                                          setCleanupDecisions((prev) => ({
                                            ...prev,
                                            [key]: {
                                              ...dec,
                                              action,
                                              selected: action !== "skip" ? true : false,
                                            },
                                          }));
                                        }}
                                      >
                                        <option value="remove" disabled={!c.canCliRemove}>
                                          Remove (CLI)
                                        </option>
                                        <option value="migrate-to-apm" disabled={!c.canCliMigrate}>
                                          Migrate to APM
                                        </option>
                                        <option value="upgrade" disabled={!c.canCliUpgrade}>
                                          Upgrade (CLI)
                                        </option>
                                        <option value="skip">Skip</option>
                                      </select>
                                    </td>
                                    <td>
                                      {dec.action === "remove" ? (
                                        <select
                                          className="select"
                                          aria-label={`Scope for ${c.skillName}`}
                                          value={dec.targetScope}
                                          onChange={(e) => {
                                            const targetScope = e.target.value as RemoveTargetScope;
                                            setCleanupDecisions((prev) => ({
                                              ...prev,
                                              [key]: { ...dec, targetScope },
                                            }));
                                          }}
                                        >
                                          <option value="all">Both (User + Projects)</option>
                                          {c.hasGlobal && (
                                            <option value="global">User / Global</option>
                                          )}
                                          {c.projectPaths.length > 0 && (
                                            <option value="project">Projects only</option>
                                          )}
                                        </select>
                                      ) : (
                                        <span style={{ color: "var(--muted)", fontSize: 11 }}>
                                          —
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <dialog
          ref={dialogRef}
          className="preview-dialog"
          aria-labelledby="preview-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewModal(null);
          }}
          onClose={(e) => {
            e.currentTarget.returnValue = "";
            setPreviewModal(null);
          }}
        >
          {previewModal && (
            <div className="dialog-body">
              <h2 id="preview-dialog-title" style={{ margin: 0 }}>
                {previewModal.removeContext ? "Confirm Remove: " : "Dry-Run Preview: "}
                {previewModal.preview.summary}
              </h2>
              {previewModal.removeContext && (
                <div
                  className="panel"
                  style={{ padding: 10, display: "grid", gap: 8, background: "var(--surface-2)" }}
                >
                  <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <span className="nav-group-label" style={{ padding: 0 }}>
                      Remove Scope
                    </span>
                    <select
                      className="select"
                      aria-label="Remove scope"
                      value={previewModal.removeContext.targetScope}
                      onChange={(e) => {
                        const targetScope = e.target.value as
                          | "all"
                          | "global"
                          | "project"
                          | "selected-projects";
                        void updateRemoveContext({
                          ...previewModal.removeContext!,
                          targetScope,
                        });
                      }}
                    >
                      <option value="all">Both (User / Global + All Projects)</option>
                      {previewModal.removeContext.hasGlobal && (
                        <option value="global">User / Global only</option>
                      )}
                      {previewModal.removeContext.availableProjects.length > 0 && (
                        <option value="project">All Project instances only</option>
                      )}
                      {previewModal.removeContext.availableProjects.length > 0 && (
                        <option value="selected-projects">Select by project…</option>
                      )}
                    </select>
                  </label>

                  {previewModal.removeContext.targetScope === "selected-projects" && (
                    <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                      <span className="nav-group-label" style={{ padding: 0 }}>
                        Projects ({previewModal.removeContext.selectedProjects.length}/
                        {previewModal.removeContext.availableProjects.length})
                      </span>
                      <div style={{ maxHeight: 150, overflowY: "auto", display: "grid", gap: 4 }}>
                        {previewModal.removeContext.availableProjects.map((proj) => {
                          const checked =
                            previewModal.removeContext!.selectedProjects.includes(proj);
                          return (
                            <label
                              key={proj}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                cursor: "pointer",
                                padding: "3px 6px",
                                borderRadius: 4,
                                background: "var(--bg)",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const prev = previewModal.removeContext!.selectedProjects;
                                  const next = checked
                                    ? prev.filter((p) => p !== proj)
                                    : [...prev, proj];
                                  void updateRemoveContext({
                                    ...previewModal.removeContext!,
                                    selectedProjects: next,
                                  });
                                }}
                              />
                              <span className="mono" style={{ fontSize: 11 }}>
                                {proj}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {previewModal.preview.commands.length > 0 && (
                <div>
                  <div className="nav-group-label" style={{ padding: 0 }}>
                    Commands
                  </div>
                  <pre>
                    {previewModal.preview.commands
                      .map(
                        (c) =>
                          `$ ${c.command} ${c.args.join(" ")}${c.cwd ? ` (cwd: ${c.cwd})` : ""}`,
                      )
                      .join("\n")}
                  </pre>
                </div>
              )}
              {previewModal.preview.pathChanges.length > 0 && (
                <div>
                  <div className="nav-group-label" style={{ padding: 0 }}>
                    Path Changes
                  </div>
                  <pre>
                    {previewModal.preview.pathChanges
                      .map((p) => `[${p.operation}] ${p.path}${p.target ? ` -> ${p.target}` : ""}`)
                      .join("\n")}
                  </pre>
                </div>
              )}
              {previewModal.preview.warnings.length > 0 && (
                <div className="badge warn">{previewModal.preview.warnings.join(" ")}</div>
              )}
              <form method="dialog" className="dialog-actions">
                <button
                  type="submit"
                  value="cancel"
                  className="btn"
                  autoFocus
                  onClick={() => setPreviewModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={previewModal.removeContext ? "btn danger" : "btn primary"}
                  disabled={previewModal.preview.commands.length === 0}
                  onClick={() => {
                    const exec = previewModal.execute;
                    setPreviewModal(null);
                    void exec().then((res) => {
                      const msg = res.success
                        ? "Action executed successfully."
                        : `Failed: ${res.errors.join("; ")}`;
                      setBanner(msg);
                      setLiveAnnouncement(msg);
                      void load(true);
                    });
                  }}
                >
                  {previewModal.removeContext ? "Confirm Remove" : "Execute"}
                </button>
              </form>
            </div>
          )}
        </dialog>
        <dialog
          ref={installDialogRef}
          className="preview-dialog"
          aria-labelledby="install-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInstallTarget(null);
          }}
          onClose={(e) => {
            e.currentTarget.returnValue = "";
            setInstallTarget(null);
          }}
        >
          {installTarget && (
            <div className="dialog-body">
              <h2 id="install-dialog-title" style={{ margin: 0 }}>
                Install {installTarget.name}
              </h2>
              <div className="mono" style={{ color: "var(--muted)" }}>
                Source: {installTarget.source} · {installTarget.installs.toLocaleString()} installs
              </div>

              <div>
                <div className="nav-group-label" style={{ padding: 0 }}>
                  Package Manager
                </div>
                <div className="chip-group">
                  <button
                    type="button"
                    className={`btn ${installManager === "npx-skills" ? "active-chip" : ""}`}
                    aria-pressed={installManager === "npx-skills"}
                    onClick={() => setInstallManager("npx-skills")}
                  >
                    npx skills
                  </button>
                  <button
                    type="button"
                    className={`btn ${installManager === "apm" ? "active-chip" : ""}`}
                    aria-pressed={installManager === "apm"}
                    onClick={() => setInstallManager("apm")}
                  >
                    APM
                  </button>
                </div>
              </div>

              <div>
                <div className="nav-group-label" style={{ padding: 0 }}>
                  Install Scope
                </div>
                <div className="chip-group">
                  <button
                    type="button"
                    className={`btn ${installScope === "global" ? "active-chip" : ""}`}
                    aria-pressed={installScope === "global"}
                    onClick={() => setInstallScope("global")}
                  >
                    Global (User)
                  </button>
                  <button
                    type="button"
                    className={`btn ${installScope === "project" ? "active-chip" : ""}`}
                    aria-pressed={installScope === "project"}
                    onClick={() => setInstallScope("project")}
                  >
                    Project-Level
                  </button>
                </div>
              </div>

              {installScope === "project" && (
                <div>
                  <label
                    htmlFor={installProjectId}
                    className="nav-group-label"
                    style={{ padding: 0, display: "block" }}
                  >
                    Project Directory Path
                  </label>
                  <input
                    id={installProjectId}
                    type="text"
                    placeholder="/Users/jc/dev/..."
                    value={installProjectPath}
                    onChange={(e) => setInstallProjectPath(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              {installPreview && (
                <div>
                  <div className="nav-group-label" style={{ padding: 0 }}>
                    Dry-Run Command Preview
                  </div>
                  <pre>
                    {installPreview.commands
                      .map(
                        (c) =>
                          `$ ${c.command} ${c.args.join(" ")}${c.cwd ? ` (cwd: ${c.cwd})` : ""}`,
                      )
                      .join("\n")}
                  </pre>
                  {installPreview.warnings.length > 0 && (
                    <div className="badge warn" style={{ marginTop: 6 }}>
                      {installPreview.warnings.join(" ")}
                    </div>
                  )}
                </div>
              )}

              <form method="dialog" className="dialog-actions">
                <button
                  type="submit"
                  value="cancel"
                  className="btn"
                  autoFocus
                  onClick={() => setInstallTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={installScope === "project" && !installProjectPath.trim()}
                  onClick={() => {
                    const target = installTarget;
                    const manager = installManager;
                    const scope = installScope;
                    const projectPath = installProjectPath.trim();
                    setInstallTarget(null);
                    setBanner(`Installing ${target.name} via ${manager} (${scope})...`);
                    void client
                      .executeInstall({
                        source: target.source,
                        skillName: target.skillId,
                        manager,
                        scope,
                        ...(scope === "project" && projectPath ? { projectPath } : {}),
                      })
                      .then((res) => {
                        const msg = res.success
                          ? `Installed ${target.name} via ${manager} (${scope}).`
                          : `Install failed: ${res.errors.join("; ")}`;
                        setBanner(msg);
                        setLiveAnnouncement(msg);
                        void load(true);
                      });
                  }}
                >
                  Install
                </button>
              </form>
            </div>
          )}
        </dialog>
      </main>
    </div>
  );
}
