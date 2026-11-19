import type { PackageManager } from "./provenance.js";

export type ActionKind = "install" | "remove" | "upgrade" | "migrate-to-apm" | "repair-link";

export interface InstallSkillRequest {
  readonly source: string;
  readonly skillName: string;
  readonly manager: "npx-skills" | "apm";
  readonly scope: "global" | "project";
  readonly projectPath?: string;
}

export interface PlannedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly description: string;
}

export interface PlannedPathChange {
  readonly operation: "delete" | "update-symlink" | "create-manifest" | "modify-manifest";
  readonly path: string;
  readonly target?: string;
  readonly reason: string;
}

export interface DryRunPreview {
  readonly action: ActionKind;
  readonly summary: string;
  readonly targetSkillIds: readonly string[];
  readonly commands: readonly PlannedCommand[];
  readonly pathChanges: readonly PlannedPathChange[];
  readonly warnings: readonly string[];
}

export interface CommandExecutionRecord {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ActionResult {
  readonly action: ActionKind;
  readonly success: boolean;
  readonly preview: DryRunPreview;
  readonly executedCommands: readonly CommandExecutionRecord[];
  readonly errors: readonly string[];
}

export type RemoveTargetScope = "all" | "global" | "project" | "selected-projects";

export interface RemoveSkillRequest {
  readonly skillId?: string;
  readonly scope?: "skill" | "author";
  readonly author?: string;
  readonly targetScope?: RemoveTargetScope;
  readonly projectPaths?: readonly string[];
  readonly exposurePath?: string;
  readonly confirmUnmanaged?: boolean;
}

export interface UpgradeRequest {
  readonly scope: "all" | "author" | "skill";
  readonly author?: string;
  readonly skillId?: string;
}

export interface MigrateToApmRequest {
  readonly skillIds: readonly string[];
  readonly apmManifestPath?: string;
  readonly cleanupLegacyLockfiles?: boolean;
}

export interface RepairLinkRequest {
  readonly brokenPath: string;
  readonly newTargetPath: string;
}

export interface ManagerDelegationTarget {
  readonly manager: PackageManager;
  readonly managedId: string;
}

export interface PrimitiveActionRequest {
  readonly action: "upgrade" | "migrate-to-apm" | "remove";
  readonly kind: "mcp" | "hook" | "command" | "lsp" | "prompt";
  readonly name: string;
  readonly harnessId?: string;
  readonly owningManager?: string;
  readonly scope?: "global" | "project" | "mixed";
  readonly path?: string;
  readonly source?: string;
}
