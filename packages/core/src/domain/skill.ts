import type { PrimitiveKind } from "./primitive.js";
import type { PackageManager, Provenance } from "./provenance.js";
import type { TokenFootprint } from "./tokens.js";
import type { SkillExposure } from "./topology.js";

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly author?: string;
  readonly version?: string;
  readonly license?: string;
  readonly deprecated?: boolean;
  readonly deprecationReason?: string;
  readonly replacedBy?: string;
  readonly rawFrontmatter: Record<string, unknown>;
}

export interface SkillUsageInfo {
  readonly lastUsedAt?: string;
  readonly activationCount: number;
  readonly lastHarness?: string;
}

export type DriftReason =
  | "global-project-overlap"
  | "content-divergence"
  | "multiple-copies"
  | "multiple-managers"
  | "duplicate-source"
  | "unmanaged-copy";

export type RelativeAge = "same" | "newer" | "older" | "different";

export interface DriftCopyInfo {
  readonly path: string;
  readonly scope: "global" | "project";
  readonly harnessId: string;
  readonly linkType: SkillExposure["linkType"];
  readonly contentHash?: string;
  readonly manager?: PackageManager;
  readonly isUnmanaged: boolean;
  readonly modifiedAt?: string;
  readonly version?: string;
  readonly relativeToGlobal?: RelativeAge;
  readonly differsFromGlobalManager?: boolean;
}

export interface DriftDetails {
  readonly reasons: readonly DriftReason[];
  readonly summary: string;
  readonly hasGlobalAndProject: boolean;
  readonly distinctHashes: number;
  readonly physicalCopies: number;
  readonly managers: readonly PackageManager[];
  readonly unmanagedPaths: readonly string[];
  readonly copies: readonly DriftCopyInfo[];
}

export type DuplicateReason =
  | "same-content-hash"
  | "same-normalized-name"
  | "multiple-physical-copies";

export interface DuplicateInfo {
  readonly reasons: readonly DuplicateReason[];
  readonly siblingIds: readonly string[];
  readonly siblingNames: readonly string[];
  readonly physicalCopies: number;
}

export interface SkillRecord {
  readonly id: string;
  readonly primitive: PrimitiveKind;
  readonly name: string;
  readonly description: string;
  readonly provenance: Provenance;
  readonly tokens: TokenFootprint;
  readonly exposures: readonly SkillExposure[];
  readonly projectPaths: readonly string[];
  readonly projectCount: number;
  readonly hasDrift: boolean;
  readonly driftDetails?: DriftDetails;
  readonly duplicates?: DuplicateInfo;
  readonly hasBrokenLinks: boolean;
  readonly usage?: SkillUsageInfo;
  readonly metadata: SkillMetadata;
}

export interface InventorySnapshot {
  readonly scannedAt: string;
  readonly skills: readonly SkillRecord[];
  readonly harnessesScanned: readonly string[];
  readonly warnings: readonly string[];
}
