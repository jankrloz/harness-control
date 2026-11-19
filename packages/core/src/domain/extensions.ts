import type { HarnessId } from "./harness.js";

export interface McpServerEntry {
  readonly name: string;
  readonly commandOrUrl: string;
  readonly transport: "stdio" | "http" | "sse";
  readonly harnesses: readonly HarnessId[];
  readonly configPaths: readonly string[];
}

export interface PrimitiveEntry {
  readonly id: string;
  readonly kind: "command" | "prompt" | "hook" | "lsp";
  readonly name: string;
  readonly harnessId: HarnessId;
  readonly path: string;
  readonly detail?: string;
}

export interface PrimitivesSnapshot {
  readonly scannedAt: string;
  readonly mcpServers: readonly McpServerEntry[];
  readonly commands: readonly PrimitiveEntry[];
  readonly prompts: readonly PrimitiveEntry[];
  readonly hooks: readonly PrimitiveEntry[];
  readonly lsps: readonly PrimitiveEntry[];
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
  readonly requests: number;
}

export interface UsageDashboardSnapshot {
  readonly scannedAt: string;
  readonly totalRequests: number;
  readonly totalTokensProcessed: number;
  readonly cacheHitRatePct: number;
  readonly estimatedCostUsd: number;
  readonly hourly: readonly UsageHourlyBucket[];
  readonly byModel: readonly UsageModelBreakdown[];
  readonly recentRequests: readonly UsageRequestLog[];
}
