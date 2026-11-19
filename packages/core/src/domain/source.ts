import type { PackageManager } from "./provenance.js";

export type SkillLifecycleState = "installed" | "available" | "deprecated";

export interface SourceSkillEntry {
  readonly name: string;
  readonly description?: string;
  readonly lifecycle: SkillLifecycleState;
  readonly installedSkillId?: string;
  readonly pathInSource?: string;
  readonly deprecationReason?: string;
  readonly replacedBy?: string;
}

export interface SourceCatalogGroup {
  readonly sourceId: string;
  readonly author: string;
  readonly sourceRepo?: string;
  readonly marketplaceName?: string;
  readonly owningManager: PackageManager;
  readonly installedCount: number;
  readonly availableCount: number;
  readonly deprecatedCount: number;
  readonly skills: readonly SourceSkillEntry[];
}
