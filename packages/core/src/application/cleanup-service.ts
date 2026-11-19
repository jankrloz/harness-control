import type {
  ActionResult,
  CommandExecutionRecord,
  DryRunPreview,
  PackageManager,
  PlannedCommand,
  PlannedPathChange,
  RemoveTargetScope,
  SkillRecord,
} from "../domain/index.js";
import type { ActionService } from "./action-service.js";

export type CleanupCategory =
  | "duplicates"
  | "drift"
  | "unused"
  | "untracked"
  | "broken"
  | "outdated";

export type CleanupActionChoice = "remove" | "migrate-to-apm" | "upgrade" | "skip";

export interface CleanupCandidate {
  readonly skillId: string;
  readonly skillName: string;
  readonly author: string;
  readonly owningManager: PackageManager;
  readonly category: CleanupCategory;
  readonly reason: string;
  readonly recommendedAction: CleanupActionChoice;
  readonly recommendedScope: RemoveTargetScope;
  readonly hasGlobal: boolean;
  readonly projectPaths: readonly string[];
  readonly descriptionTokens: number;
  readonly fullTokens: number;
  readonly canCliRemove: boolean;
  readonly canCliMigrate: boolean;
  readonly canCliUpgrade: boolean;
}

export interface CleanupQueueItem {
  readonly skillId: string;
  readonly category: CleanupCategory;
  readonly action: CleanupActionChoice;
  readonly targetScope?: RemoveTargetScope;
  readonly projectPaths?: readonly string[];
}

export interface CleanupImpact {
  readonly totalCandidates: number;
  readonly selectedCount: number;
  readonly removeCount: number;
  readonly migrateCount: number;
  readonly upgradeCount: number;
  readonly byCategorySelected: Record<CleanupCategory, number>;
  readonly tokensSavedDesc: number;
  readonly tokensSavedFull: number;
  readonly tokensSavedDescPct: number;
  readonly tokensSavedFullPct: number;
}

export interface CleanupPreviewResponse {
  readonly summary: string;
  readonly impact: CleanupImpact;
  readonly commands: readonly PlannedCommand[];
  readonly pathChanges: readonly PlannedPathChange[];
  readonly warnings: readonly string[];
}

export interface CleanupExecuteResponse {
  readonly success: boolean;
  readonly preview: CleanupPreviewResponse;
  readonly executedCommands: readonly CommandExecutionRecord[];
  readonly errors: readonly string[];
}

const CLI_MANAGED = new Set<PackageManager>([
  "apm",
  "npx-skills",
  "claude-plugin",
  "gemini-extension",
]);

export function buildCleanupCandidates(skills: readonly SkillRecord[]): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = [];

  for (const s of skills) {
    const canCliRemove = CLI_MANAGED.has(s.provenance.owningManager);
    const canCliUpgrade = CLI_MANAGED.has(s.provenance.owningManager);
    const canCliMigrate =
      s.provenance.owningManager !== "apm" &&
      Boolean(s.provenance.sourceRepo || s.provenance.managedId);
    const hasGlobal = s.exposures.some((e) => e.scope === "global");

    const base = {
      skillId: s.id,
      skillName: s.name,
      author: s.provenance.author,
      owningManager: s.provenance.owningManager,
      hasGlobal,
      projectPaths: s.projectPaths,
      descriptionTokens: s.tokens.descriptionTokens,
      fullTokens: s.tokens.fullTokens,
      canCliRemove,
      canCliMigrate,
      canCliUpgrade,
    };

    if (s.duplicates) {
      const siblingPart =
        s.duplicates.siblingNames.length > 0
          ? ` · siblings: ${s.duplicates.siblingNames.join(", ")}`
          : "";
      candidates.push({
        ...base,
        category: "duplicates",
        reason: `${s.duplicates.reasons.map((r) => r.replace(/-/g, " ")).join(", ")}${siblingPart}`,
        recommendedAction: canCliRemove ? "remove" : canCliMigrate ? "migrate-to-apm" : "skip",
        recommendedScope: hasGlobal && s.projectPaths.length > 0 ? "project" : "all",
      });
    }

    if (s.hasDrift) {
      candidates.push({
        ...base,
        category: "drift",
        reason: s.driftDetails?.summary ?? "content or manager drift",
        recommendedAction:
          s.driftDetails?.reasons.includes("multiple-managers") && canCliMigrate
            ? "migrate-to-apm"
            : canCliRemove
              ? "remove"
              : "skip",
        recommendedScope: hasGlobal && s.projectPaths.length > 0 ? "project" : "all",
      });
    }

    if ((s.usage?.activationCount ?? 0) === 0) {
      candidates.push({
        ...base,
        category: "unused",
        reason: "0 activations in session logs",
        recommendedAction: canCliRemove ? "remove" : "skip",
        recommendedScope: "all",
      });
    }

    if (s.provenance.owningManager === "manual" || s.provenance.owningManager === "git-clone") {
      candidates.push({
        ...base,
        category: "untracked",
        reason: `${s.provenance.owningManager} (unmanaged)`,
        recommendedAction: canCliMigrate ? "migrate-to-apm" : "skip",
        recommendedScope: "all",
      });
    }

    if (s.hasBrokenLinks) {
      candidates.push({
        ...base,
        category: "broken",
        reason: "broken symlink exposure(s)",
        recommendedAction: canCliRemove ? "remove" : "skip",
        recommendedScope: "all",
      });
    }

    if (s.provenance.updateStatus.updateAvailable) {
      const cur =
        s.provenance.updateStatus.currentVersion ??
        s.provenance.updateStatus.currentCommit ??
        "current";
      const lat =
        s.provenance.updateStatus.latestVersion ??
        s.provenance.updateStatus.latestCommit ??
        "latest";
      candidates.push({
        ...base,
        category: "outdated",
        reason: `${cur} -> ${lat}`,
        recommendedAction: canCliUpgrade ? "upgrade" : "skip",
        recommendedScope: "all",
      });
    }
  }

  return candidates;
}

export function computeCleanupImpact(
  skills: readonly SkillRecord[],
  totalCandidates: number,
  queue: readonly CleanupQueueItem[],
): CleanupImpact {
  const totalDesc = skills.reduce((acc, s) => acc + s.tokens.descriptionTokens, 0);
  const totalFull = skills.reduce((acc, s) => acc + s.tokens.fullTokens, 0);
  const byId = new Map(skills.map((s) => [s.id, s]));

  const byCategorySelected: Record<CleanupCategory, number> = {
    duplicates: 0,
    drift: 0,
    unused: 0,
    untracked: 0,
    broken: 0,
    outdated: 0,
  };

  const active = queue.filter((q) => q.action !== "skip");
  for (const item of active) {
    byCategorySelected[item.category] += 1;
  }

  // Deduplicate token savings by skillId
  const removedIds = new Set<string>();
  const migratedIds = new Set<string>();
  const upgradedIds = new Set<string>();

  for (const item of active) {
    if (item.action === "remove") removedIds.add(item.skillId);
    else if (item.action === "migrate-to-apm") migratedIds.add(item.skillId);
    else if (item.action === "upgrade") upgradedIds.add(item.skillId);
  }

  let tokensSavedDesc = 0;
  let tokensSavedFull = 0;
  for (const id of removedIds) {
    const sk = byId.get(id);
    if (!sk) continue;
    tokensSavedDesc += sk.tokens.descriptionTokens;
    tokensSavedFull += sk.tokens.fullTokens;
  }

  return {
    totalCandidates,
    selectedCount: active.length,
    removeCount: removedIds.size,
    migrateCount: migratedIds.size,
    upgradeCount: upgradedIds.size,
    byCategorySelected,
    tokensSavedDesc,
    tokensSavedFull,
    tokensSavedDescPct: totalDesc > 0 ? Math.round((tokensSavedDesc / totalDesc) * 100) : 0,
    tokensSavedFullPct: totalFull > 0 ? Math.round((tokensSavedFull / totalFull) * 100) : 0,
  };
}

export function previewCleanupQueue(
  actionService: ActionService,
  skills: readonly SkillRecord[],
  queue: readonly CleanupQueueItem[],
): CleanupPreviewResponse {
  const candidates = buildCleanupCandidates(skills);
  const impact = computeCleanupImpact(skills, candidates.length, queue);

  const commands: PlannedCommand[] = [];
  const pathChanges: PlannedPathChange[] = [];
  const warnings: string[] = [];
  const seenCmds = new Set<string>();
  const seenSkillActions = new Set<string>();

  const appendPreview = (p: DryRunPreview) => {
    for (const c of p.commands) {
      const key = `${c.command}:${c.args.join(" ")}:${c.cwd ?? ""}`;
      if (!seenCmds.has(key)) {
        seenCmds.add(key);
        commands.push(c);
      }
    }
    pathChanges.push(...p.pathChanges);
    for (const w of p.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  };

  for (const item of queue) {
    if (item.action === "skip") continue;
    const dedupeKey = `${item.action}:${item.skillId}:${item.targetScope ?? "all"}`;
    if (seenSkillActions.has(dedupeKey)) continue;
    seenSkillActions.add(dedupeKey);

    if (item.action === "remove") {
      appendPreview(
        actionService.previewRemove(skills, {
          skillId: item.skillId,
          ...(item.targetScope ? { targetScope: item.targetScope } : {}),
          ...(item.projectPaths ? { projectPaths: item.projectPaths } : {}),
        }),
      );
    } else if (item.action === "migrate-to-apm") {
      appendPreview(
        actionService.previewMigrateToApm(skills, {
          skillIds: [item.skillId],
          cleanupLegacyLockfiles: true,
        }),
      );
    } else if (item.action === "upgrade") {
      appendPreview(
        actionService.previewUpgrade(skills, {
          scope: "skill",
          skillId: item.skillId,
        }),
      );
    }
  }

  return {
    summary: `Cleanup queue: ${impact.removeCount} remove, ${impact.migrateCount} migrate, ${impact.upgradeCount} upgrade (-${impact.tokensSavedDesc} desc tokens / -${impact.tokensSavedDescPct}%)`,
    impact,
    commands,
    pathChanges,
    warnings,
  };
}

export async function executeCleanupQueue(
  actionService: ActionService,
  skills: readonly SkillRecord[],
  queue: readonly CleanupQueueItem[],
): Promise<CleanupExecuteResponse> {
  const preview = previewCleanupQueue(actionService, skills, queue);
  const executedCommands: CommandExecutionRecord[] = [];
  const errors: string[] = [];
  const seenSkillActions = new Set<string>();

  const recordResult = (res: ActionResult) => {
    executedCommands.push(...res.executedCommands);
    if (!res.success) errors.push(...res.errors);
  };

  for (const item of queue) {
    if (item.action === "skip") continue;
    const dedupeKey = `${item.action}:${item.skillId}:${item.targetScope ?? "all"}`;
    if (seenSkillActions.has(dedupeKey)) continue;
    seenSkillActions.add(dedupeKey);

    if (item.action === "remove") {
      recordResult(
        await actionService.executeRemove(skills, {
          skillId: item.skillId,
          ...(item.targetScope ? { targetScope: item.targetScope } : {}),
          ...(item.projectPaths ? { projectPaths: item.projectPaths } : {}),
        }),
      );
    } else if (item.action === "migrate-to-apm") {
      recordResult(
        await actionService.executeMigrateToApm(skills, {
          skillIds: [item.skillId],
          cleanupLegacyLockfiles: true,
        }),
      );
    } else if (item.action === "upgrade") {
      recordResult(
        await actionService.executeUpgrade(skills, {
          scope: "skill",
          skillId: item.skillId,
        }),
      );
    }
  }

  return {
    success: errors.length === 0,
    preview,
    executedCommands,
    errors,
  };
}
