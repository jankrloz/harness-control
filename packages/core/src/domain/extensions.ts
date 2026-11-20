import type { HarnessId } from "./harness.js";
import type { PackageManager } from "./provenance.js";

export interface PrimitiveExposure {
  readonly harnessId: HarnessId;
  readonly scope: "global" | "project";
  readonly path: string;
  readonly detail?: string;
  readonly linkType?: "symlink" | "copy" | "config";
}

export interface McpServerEntry {
  readonly id: string;
  readonly name: string;
  readonly commandOrUrl: string;
  readonly transport: "stdio" | "http" | "sse";
  readonly harnesses: readonly HarnessId[];
  readonly configPaths: readonly string[];
  readonly scope: "global" | "project" | "mixed";
  readonly owningManager: PackageManager;
  readonly exposures: readonly PrimitiveExposure[];
  readonly hasDrift: boolean;
  readonly driftSummary?: string;
  readonly estimatedTokens: number;
}

export interface PrimitiveEntry {
  readonly id: string;
  readonly kind: "command" | "prompt" | "hook" | "lsp";
  readonly name: string;
  readonly harnessId: HarnessId;
  readonly path: string;
  readonly detail?: string;
  readonly scope: "global" | "project";
  readonly owningManager: PackageManager;
  readonly exposures: readonly PrimitiveExposure[];
  readonly hasDrift: boolean;
  readonly driftSummary?: string;
  readonly estimatedTokens: number;
}

export interface PrimitivesSummary {
  readonly totalPrimitives: number;
  readonly driftedCount: number;
  readonly totalEstimatedTokens: number;
}

export interface PrimitivesSnapshot {
  readonly scannedAt: string;
  readonly mcpServers: readonly McpServerEntry[];
  readonly commands: readonly PrimitiveEntry[];
  readonly prompts: readonly PrimitiveEntry[];
  readonly hooks: readonly PrimitiveEntry[];
  readonly lsps: readonly PrimitiveEntry[];
  readonly summary: PrimitivesSummary;
}

export interface SessionSummary {
  readonly id: string;
  readonly harnessId: HarnessId;
  readonly title: string;
  readonly projectFolder?: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly model?: string;
  readonly transcriptPath: string;
}

export interface SessionMessage {
  readonly role: "user" | "assistant" | "system";
  readonly timestamp?: string;
  readonly model?: string;
  readonly tokens?: number;
  readonly content: string;
}

export interface SessionDetail {
  readonly id: string;
  readonly harnessId: HarnessId;
  readonly title: string;
  readonly projectFolder?: string;
  readonly transcriptPath: string;
  readonly updatedAt: string;
  readonly model?: string;
  readonly promptCount: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly messages: readonly SessionMessage[];
}

export interface UsageRequestLog {
  readonly timestamp: string;
  readonly harnessId: HarnessId;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly estimatedCostUsd: number;
}

export interface UsageModelBreakdown {
  readonly model: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly estimatedCostUsd: number;
}

export interface UsageHourlyBucket {
  readonly hour: string;
  readonly tokens: number;
  readonly costUsd: number;
  readonly requests: number;
}

export interface UsageDailyBucket {
  readonly date: string;
  readonly tokens: number;
  readonly costUsd: number;
  readonly requests: number;
}

export interface UsageHarnessBreakdown {
  readonly harnessId: HarnessId;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly estimatedCostUsd: number;
  readonly topModel?: string;
}

export interface UsageDashboardSnapshot {
  readonly scannedAt: string;
  readonly totalRequests: number;
  readonly totalTokensProcessed: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheReadTokens: number;
  readonly activeDays: number;
  readonly cacheHitRatePct: number;
  readonly estimatedCostUsd: number;
  readonly hourly: readonly UsageHourlyBucket[];
  readonly daily: readonly UsageDailyBucket[];
  readonly byModel: readonly UsageModelBreakdown[];
  readonly byHarness: readonly UsageHarnessBreakdown[];
  readonly recentRequests: readonly UsageRequestLog[];
}
