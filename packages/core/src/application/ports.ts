import type {
  CommandExecutionRecord,
  HarnessDefinition,
  HarnessId,
  PackageManager,
  PlannedCommand,
  PlannedPathChange,
  Scope,
  SkillMetadata,
  SkillUsageInfo,
  TokenFootprint,
  UpdateStatus,
  LinkType,
} from "../domain/index.js";

export interface DiscoveredSkillExposure {
  readonly skillName: string;
  readonly harnessId: HarnessId;
  readonly scope: Scope;
  readonly profile?: string;
  readonly path: string;
  readonly skillFilePath: string;
  readonly linkType: LinkType;
  readonly symlinkTarget?: string;
  readonly projectRoot?: string;
  readonly contentHash?: string;
  readonly modifiedAt?: string;
  readonly version?: string;
  readonly rawContent?: string;
  readonly frontmatterRaw?: string;
  readonly bodyRaw?: string;
  readonly metadata?: SkillMetadata;
  readonly hintedManager?: PackageManager;
  readonly hintedManagedId?: string;
  readonly hintedAuthor?: string;
  readonly hintedSourceRepo?: string;
}

export interface NativeCliSkillEntry {
  readonly name: string;
  readonly owningManager: PackageManager;
  readonly managedId?: string;
  readonly harnessId?: HarnessId;
  readonly scope?: Scope;
  readonly installPath?: string;
  readonly author?: string;
  readonly sourceRepo?: string;
  readonly version?: string;
  readonly updateAvailable?: boolean;
  readonly latestVersion?: string;
}

export interface NativeCliScanResult {
  readonly entries: readonly NativeCliSkillEntry[];
  readonly warnings: readonly string[];
}

export interface GitRepoInfo {
  readonly remoteUrl?: string;
  readonly canonicalAuthor?: string;
  readonly sourceRepo?: string;
  readonly currentCommit?: string;
  readonly updateStatus: UpdateStatus;
}

export interface HarnessManagerConfig {
  readonly workspaceRoots: readonly string[];
  readonly customHarnesses: readonly HarnessDefinition[];
  readonly maxScanDepth: number;
  readonly checkRemoteUpdates: boolean;
}

export interface SkillScannerPort {
  scanGlobalHarnesses(
    harnesses: readonly HarnessDefinition[],
  ): Promise<readonly DiscoveredSkillExposure[]>;
  scanWorkspaces(
    workspaceRoots: readonly string[],
    harnesses: readonly HarnessDefinition[],
    maxDepth: number,
  ): Promise<readonly DiscoveredSkillExposure[]>;
}

export interface NativeCliPort {
  discoverAll(harnesses: readonly HarnessDefinition[]): Promise<NativeCliScanResult>;
}

export interface TokenCounterPort {
  countText(text: string): number;
  measureSkill(
    description: string,
    frontmatterRaw: string,
    bodyRaw: string,
    fullRaw: string,
  ): TokenFootprint;
}

export interface GitInspectorPort {
  inspectPath(targetPath: string, checkRemote: boolean): Promise<GitRepoInfo | null>;
}

export interface CommandExecutorPort {
  executeCommand(cmd: PlannedCommand): Promise<CommandExecutionRecord>;
  applyPathChange(change: PlannedPathChange): Promise<void>;
}

export interface ConfigPort {
  loadConfig(): Promise<HarnessManagerConfig>;
  saveConfig(config: HarnessManagerConfig): Promise<void>;
}

export interface UpstreamSourceSkill {
  readonly name: string;
  readonly description?: string;
  readonly pathInSource?: string;
  readonly deprecated?: boolean;
  readonly deprecationReason?: string;
  readonly replacedBy?: string;
}

export interface UpstreamSourceCatalog {
  readonly sourceId: string;
  readonly author: string;
  readonly sourceRepo?: string;
  readonly marketplaceName?: string;
  readonly owningManager?: PackageManager;
  readonly catalogComplete: boolean;
  readonly skills: readonly UpstreamSourceSkill[];
}

export interface SourceCatalogPort {
  discoverCatalogs(
    installedSkills: readonly import("../domain/index.js").SkillRecord[],
    checkRemote: boolean,
  ): Promise<readonly UpstreamSourceCatalog[]>;
}

export interface SkillUsagePort {
  collectUsage(): Promise<ReadonlyMap<string, SkillUsageInfo>>;
}
