import type {
  ActionResult,
  CleanupCandidate,
  CleanupExecuteResponse,
  CleanupPreviewResponse,
  CleanupQueueItem,
  DryRunPreview,
  GlobalTokenTelemetry,
  HarnessDefinition,
  InventorySnapshot,
  MigrateToApmRequest,
  PrimitivesSnapshot,
  RemoveSkillRequest,
  RepairLinkRequest,
  SessionSummary,
  SourceCatalogGroup,
  UpgradeRequest,
  UsageDashboardSnapshot,
} from "@harness-control/core";
import type { HarnessManagerConfig } from "@harness-control/core";

export interface DaemonStatus {
  readonly status: "ok";
  readonly version: string;
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly startedAt: string;
  readonly uptimeSeconds: number;
  readonly lastScanAt: string | null;
  readonly cachedSkillsCount: number;
  readonly harnessesCount: number;
}

export interface DiscoverSkillEntry {
  readonly id: string;
  readonly source: string;
  readonly skillId: string;
  readonly name: string;
  readonly installs: number;
  readonly skillsShUrl: string;
  readonly isInstalled: boolean;
}

export interface DiscoverResponse {
  readonly query: string;
  readonly mode: "search" | "trending";
  readonly provider: string;
  readonly skills: readonly DiscoverSkillEntry[];
}

export interface SkillContentResponse {
  readonly skillId: string;
  readonly skillFilePath: string;
  readonly rawContent: string;
  readonly frontmatterRaw: string;
  readonly bodyRaw: string;
  readonly skillsShUrl: string;
}

export interface InventoryResponse {
  readonly snapshot: InventorySnapshot;
  readonly telemetry: GlobalTokenTelemetry;
  readonly harnesses: readonly HarnessDefinition[];
  readonly sources: readonly SourceCatalogGroup[];
}

export class DaemonClient {
  constructor(private readonly baseUrl = "http://127.0.0.1:4318") {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<DaemonStatus | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`);
      if (!res.ok) return null;
      return (await res.json()) as DaemonStatus;
    } catch {
      return null;
    }
  }

  async getInventory(refresh = false): Promise<InventoryResponse> {
    return this.request<InventoryResponse>(`/api/inventory${refresh ? "?refresh=true" : ""}`);
  }

  async getConfig(): Promise<HarnessManagerConfig> {
    return this.request<HarnessManagerConfig>("/api/config");
  }

  async previewRemove(req: RemoveSkillRequest): Promise<DryRunPreview> {
    return this.post("/api/actions/remove/preview", req);
  }

  async executeRemove(req: RemoveSkillRequest): Promise<ActionResult> {
    return this.post("/api/actions/remove/execute", req);
  }

  async previewUpgrade(req: UpgradeRequest): Promise<DryRunPreview> {
    return this.post("/api/actions/upgrade/preview", req);
  }

  async executeUpgrade(req: UpgradeRequest): Promise<ActionResult> {
    return this.post("/api/actions/upgrade/execute", req);
  }

  async previewMigrateToApm(req: MigrateToApmRequest): Promise<DryRunPreview> {
    return this.post("/api/actions/migrate-to-apm/preview", req);
  }

  async executeMigrateToApm(req: MigrateToApmRequest): Promise<ActionResult> {
    return this.post("/api/actions/migrate-to-apm/execute", req);
  }

  async previewRepairLink(req: RepairLinkRequest): Promise<DryRunPreview> {
    return this.post("/api/actions/repair-link/preview", req);
  }

  async executeRepairLink(req: RepairLinkRequest): Promise<ActionResult> {
    return this.post("/api/actions/repair-link/execute", req);
  }

  async getCleanupPlan(refresh = false): Promise<{
    candidates: readonly CleanupCandidate[];
    totalSkills: number;
  }> {
    return this.request(`/api/cleanup/plan${refresh ? "?refresh=true" : ""}`);
  }

  async previewCleanup(items: readonly CleanupQueueItem[]): Promise<CleanupPreviewResponse> {
    return this.post("/api/cleanup/preview", { items });
  }

  async executeCleanup(items: readonly CleanupQueueItem[]): Promise<CleanupExecuteResponse> {
    return this.post("/api/cleanup/execute", { items });
  }

  async getPrimitives(): Promise<PrimitivesSnapshot> {
    return this.request("/api/primitives");
  }

  async getSessions(): Promise<{ sessions: readonly SessionSummary[]; total: number }> {
    return this.request("/api/sessions");
  }

  async getUsageMetrics(): Promise<UsageDashboardSnapshot> {
    return this.request("/api/usage-metrics");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      throw new Error(`Daemon request failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
