import type {
  DriftCopyInfo,
  DriftDetails,
  DriftReason,
  DuplicateInfo,
  DuplicateReason,
  HarnessDefinition,
  InventorySnapshot,
  PackageManager,
  Provenance,
  RelativeAge,
  SkillExposure,
  SkillMetadata,
  SkillRecord,
  TokenFootprint,
  UpdateStatus,
} from "../domain/index.js";
import type {
  DiscoveredSkillExposure,
  GitInspectorPort,
  HarnessManagerConfig,
  NativeCliPort,
  NativeCliSkillEntry,
  SkillScannerPort,
  SkillUsagePort,
  TokenCounterPort,
} from "./ports.js";

const ZERO_TOKENS: TokenFootprint = {
  descriptionTokens: 0,
  frontmatterTokens: 0,
  bodyTokens: 0,
  fullTokens: 0,
};

function normalizeSkillId(name: string, author?: string): string {
  const cleanName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  if (author && author !== "unknown") {
    const cleanAuthor = author
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");
    return `${cleanAuthor}/${cleanName}`;
  }
  return cleanName;
}

const INVALID_AUTHORS = new Set(["agents", ".agents", "skills", "local", "none", ""]);

function sanitizeAuthor(raw?: string): string {
  const trimmed = raw?.trim();
  if (!trimmed || INVALID_AUTHORS.has(trimmed.toLowerCase())) return "unknown";
  return trimmed;
}

function inferAuthorFromRepo(sourceRepo?: string): string | undefined {
  if (!sourceRepo) return undefined;
  const match = sourceRepo.match(/[:/]([^/]+)\/[^/]+?(?:\.git)?$/);
  const candidate = match?.[1]?.trim();
  if (!candidate || INVALID_AUTHORS.has(candidate.toLowerCase())) return undefined;
  return candidate;
}

export class InventoryService {
  constructor(
    private readonly scanner: SkillScannerPort,
    private readonly nativeCli: NativeCliPort,
    private readonly tokenCounter: TokenCounterPort,
    private readonly gitInspector: GitInspectorPort,
    private readonly usageInspector?: SkillUsagePort,
  ) {}

  async scan(
    harnesses: readonly HarnessDefinition[],
    config: HarnessManagerConfig,
  ): Promise<InventorySnapshot> {
    const [globalExposures, projectExposures, cliResult, usageMap] = await Promise.all([
      this.scanner.scanGlobalHarnesses(harnesses),
      config.workspaceRoots.length > 0
        ? this.scanner.scanWorkspaces(config.workspaceRoots, harnesses, config.maxScanDepth)
        : Promise.resolve([]),
      this.nativeCli.discoverAll(harnesses),
      this.usageInspector ? this.usageInspector.collectUsage() : Promise.resolve(new Map()),
    ]);

    const allExposures = [...globalExposures, ...projectExposures];
    const cliByName = new Map<string, NativeCliSkillEntry[]>();
    for (const entry of cliResult.entries) {
      const key = entry.name.toLowerCase();
      const list = cliByName.get(key) ?? [];
      list.push(entry);
      cliByName.set(key, list);
    }

    const grouped = new Map<string, DiscoveredSkillExposure[]>();
    for (const exp of allExposures) {
      const key = exp.skillName.toLowerCase();
      const list = grouped.get(key) ?? [];
      list.push(exp);
      grouped.set(key, list);
    }

    const skills: SkillRecord[] = [];
    for (const [key, rawExposures] of grouped.entries()) {
      const cliMatches = cliByName.get(key) ?? [];
      const skill = await this.buildSkillRecord(
        rawExposures,
        cliMatches,
        config.checkRemoteUpdates,
      );
      const usage = usageMap.get(skill.name.toLowerCase()) ?? usageMap.get(key);
      skills.push(usage ? { ...skill, usage } : skill);
    }

    // Include CLI-only skills that had no filesystem exposure discovered
    for (const [key, cliEntries] of cliByName.entries()) {
      if (grouped.has(key)) continue;
      const first = cliEntries[0];
      if (!first) continue;
      const author = sanitizeAuthor(first.author ?? inferAuthorFromRepo(first.sourceRepo));
      skills.push({
        id: normalizeSkillId(first.name, author),
        primitive: "skill",
        name: first.name,
        description: "",
        provenance: {
          author,
          ...(first.sourceRepo ? { sourceRepo: first.sourceRepo } : {}),
          owningManager: first.owningManager,
          ...(first.managedId ? { managedId: first.managedId } : {}),
          updateStatus: {
            ...(first.version ? { currentVersion: first.version } : {}),
            ...(first.latestVersion ? { latestVersion: first.latestVersion } : {}),
            updateAvailable: Boolean(first.updateAvailable),
          },
        },
        tokens: ZERO_TOKENS,
        exposures: [],
        projectPaths: [],
        projectCount: 0,
        hasDrift: false,
        hasBrokenLinks: false,
        metadata: {
          name: first.name,
          description: "",
          ...(first.author ? { author: first.author } : {}),
          ...(first.version ? { version: first.version } : {}),
          rawFrontmatter: {},
        },
      });
    }

    const annotatedSkills = annotateDuplicates(skills);
    annotatedSkills.sort((a, b) => a.name.localeCompare(b.name));

    return {
      scannedAt: new Date().toISOString(),
      skills: annotatedSkills,
      harnessesScanned: harnesses.map((h) => h.id),
      warnings: cliResult.warnings,
    };
  }

  private async buildSkillRecord(
    rawExposures: readonly DiscoveredSkillExposure[],
    cliMatches: readonly NativeCliSkillEntry[],
    checkRemoteUpdates: boolean,
  ): Promise<SkillRecord> {
    const primary =
      rawExposures.find((e) => e.scope === "global" && e.rawContent) ??
      rawExposures.find((e) => e.rawContent) ??
      rawExposures[0]!;

    const metadata: SkillMetadata = primary.metadata ?? {
      name: primary.skillName,
      description: "",
      rawFrontmatter: {},
    };

    const tokens =
      primary.rawContent !== undefined
        ? this.tokenCounter.measureSkill(
            metadata.description,
            primary.frontmatterRaw ?? "",
            primary.bodyRaw ?? "",
            primary.rawContent,
          )
        : ZERO_TOKENS;

    // Inspect git repo on symlink target or physical path
    const inspectTarget = primary.symlinkTarget ?? primary.path;
    const gitInfo = await this.gitInspector.inspectPath(inspectTarget, checkRemoteUpdates);

    const cliMatch = cliMatches[0];
    const hintedManager = rawExposures.find((e) => e.hintedManager)?.hintedManager;
    const owningManager: PackageManager =
      cliMatch?.owningManager ?? hintedManager ?? (gitInfo?.remoteUrl ? "git-clone" : "manual");

    const sourceRepo = cliMatch?.sourceRepo ?? primary.hintedSourceRepo ?? gitInfo?.sourceRepo;
    const author = sanitizeAuthor(
      metadata.author ??
        cliMatch?.author ??
        primary.hintedAuthor ??
        gitInfo?.canonicalAuthor ??
        inferAuthorFromRepo(sourceRepo),
    );

    const currentVersion = metadata.version ?? cliMatch?.version;
    const latestVersion = cliMatch?.latestVersion ?? gitInfo?.updateStatus.latestVersion;
    const updateStatus: UpdateStatus = {
      ...(currentVersion ? { currentVersion } : {}),
      ...(gitInfo?.currentCommit ? { currentCommit: gitInfo.currentCommit } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      ...(gitInfo?.updateStatus.latestCommit
        ? { latestCommit: gitInfo.updateStatus.latestCommit }
        : {}),
      updateAvailable: Boolean(cliMatch?.updateAvailable ?? gitInfo?.updateStatus.updateAvailable),
      ...(gitInfo?.updateStatus.checkedAt ? { checkedAt: gitInfo.updateStatus.checkedAt } : {}),
    };

    const provenance: Provenance = {
      author,
      ...(sourceRepo ? { sourceRepo } : {}),
      owningManager,
      ...((cliMatch?.managedId ?? primary.hintedManagedId)
        ? { managedId: cliMatch?.managedId ?? primary.hintedManagedId }
        : {}),
      updateStatus,
    };

    const exposures: SkillExposure[] = rawExposures.map((e) => ({
      harnessId: e.harnessId,
      scope: e.scope,
      ...(e.profile ? { profile: e.profile } : {}),
      path: e.path,
      skillFilePath: e.skillFilePath,
      linkType: e.linkType,
      ...(e.symlinkTarget ? { symlinkTarget: e.symlinkTarget } : {}),
      ...(e.projectRoot ? { projectRoot: e.projectRoot } : {}),
      ...(e.contentHash ? { contentHash: e.contentHash } : {}),
      ...(e.modifiedAt ? { modifiedAt: e.modifiedAt } : {}),
      ...(e.version ? { version: e.version } : {}),
    }));

    const projectPaths = Array.from(
      new Set(
        exposures.filter((e) => e.scope === "project" && e.projectRoot).map((e) => e.projectRoot!),
      ),
    ).sort();

    const distinctHashSet = new Set(
      exposures.map((e) => e.contentHash).filter((h): h is string => Boolean(h)),
    );
    const physicalPaths = new Set(
      exposures
        .filter((e) => e.linkType !== "symlink-broken")
        .map((e) => e.symlinkTarget ?? e.path),
    );
    const physicalCopies = physicalPaths.size;

    const managerSet = new Set<PackageManager>();
    managerSet.add(owningManager);
    for (const c of cliMatches) managerSet.add(c.owningManager);
    for (const e of rawExposures) {
      if (e.hintedManager) managerSet.add(e.hintedManager);
    }
    const managers = Array.from(managerSet);

    const globalRef =
      rawExposures.find((e) => e.scope === "global" && e.contentHash) ??
      rawExposures.find((e) => e.scope === "global");
    const globalRefManager = globalRef?.hintedManager ?? cliMatch?.owningManager;
    const hasGlobalAndProject =
      rawExposures.some((e) => e.scope === "global") &&
      rawExposures.some((e) => e.scope === "project");

    const copies: DriftCopyInfo[] = rawExposures.map((e) => {
      const copyManager = e.hintedManager ?? cliMatch?.owningManager;
      const isUnmanaged = !copyManager || copyManager === "manual" || copyManager === "git-clone";
      let relativeToGlobal: RelativeAge | undefined;
      if (e.scope === "project" && globalRef) {
        if (e.contentHash && globalRef.contentHash && e.contentHash === globalRef.contentHash) {
          relativeToGlobal = "same";
        } else if (e.modifiedAt && globalRef.modifiedAt) {
          const projMs = Date.parse(e.modifiedAt);
          const globMs = Date.parse(globalRef.modifiedAt);
          if (projMs > globMs + 1000) relativeToGlobal = "newer";
          else if (projMs + 1000 < globMs) relativeToGlobal = "older";
          else relativeToGlobal = "different";
        } else {
          relativeToGlobal = "different";
        }
      }
      const differsFromGlobalManager =
        e.scope === "project" &&
        Boolean(copyManager) &&
        Boolean(globalRefManager) &&
        copyManager !== globalRefManager;

      return {
        path: e.path,
        scope: e.scope,
        harnessId: e.harnessId,
        linkType: e.linkType,
        ...(e.contentHash ? { contentHash: e.contentHash } : {}),
        ...(copyManager ? { manager: copyManager } : {}),
        isUnmanaged,
        ...(e.modifiedAt ? { modifiedAt: e.modifiedAt } : {}),
        ...(e.version ? { version: e.version } : {}),
        ...(relativeToGlobal ? { relativeToGlobal } : {}),
        ...(differsFromGlobalManager ? { differsFromGlobalManager } : {}),
      };
    });

    const unmanagedPaths = Array.from(
      new Set(copies.filter((c) => c.isUnmanaged).map((c) => c.path)),
    );

    const reasons: DriftReason[] = [];
    if (hasGlobalAndProject) reasons.push("global-project-overlap");
    if (distinctHashSet.size > 1) reasons.push("content-divergence");
    if (physicalCopies > 1) reasons.push("multiple-copies");
    if (managers.length > 1) reasons.push("multiple-managers");
    if (reasons.length > 0 && unmanagedPaths.length > 0) reasons.push("unmanaged-copy");

    const hasDrift = reasons.length > 0;
    const driftDetails: DriftDetails | undefined = hasDrift
      ? {
          reasons,
          summary: [
            hasGlobalAndProject ? "installed at both global & project" : null,
            distinctHashSet.size > 1 ? `${distinctHashSet.size} content hashes` : null,
            physicalCopies > 1 ? `${physicalCopies} physical copies` : null,
            managers.length > 1 ? `${managers.length} managers (${managers.join(", ")})` : null,
            unmanagedPaths.length > 0 ? `${unmanagedPaths.length} unmanaged path(s)` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          hasGlobalAndProject,
          distinctHashes: distinctHashSet.size,
          physicalCopies,
          managers,
          unmanagedPaths,
          copies,
        }
      : undefined;

    const hasBrokenLinks = exposures.some((e) => e.linkType === "symlink-broken");

    return {
      id: normalizeSkillId(metadata.name || primary.skillName, author),
      primitive: "skill",
      name: metadata.name || primary.skillName,
      description: metadata.description,
      provenance,
      tokens,
      exposures,
      projectPaths,
      projectCount: projectPaths.length,
      hasDrift,
      ...(driftDetails ? { driftDetails } : {}),
      hasBrokenLinks,
      metadata,
    };
  }
}

function countPhysicalCopies(exposures: readonly SkillExposure[]): number {
  return new Set(
    exposures.filter((e) => e.linkType !== "symlink-broken").map((e) => e.symlinkTarget ?? e.path),
  ).size;
}

function annotateDuplicates(skills: readonly SkillRecord[]): SkillRecord[] {
  const byHash = new Map<string, SkillRecord[]>();
  const byNormName = new Map<string, SkillRecord[]>();

  for (const s of skills) {
    const norm = s.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const nameList = byNormName.get(norm) ?? [];
    nameList.push(s);
    byNormName.set(norm, nameList);

    const hashes = new Set(
      s.exposures.map((e) => e.contentHash).filter((h): h is string => Boolean(h)),
    );
    for (const h of hashes) {
      const hashList = byHash.get(h) ?? [];
      hashList.push(s);
      byHash.set(h, hashList);
    }
  }

  return skills.map((s) => {
    const reasons: DuplicateReason[] = [];
    const siblingMap = new Map<string, string>();
    const physicalCopies = s.driftDetails?.physicalCopies ?? countPhysicalCopies(s.exposures);

    const hashes = new Set(
      s.exposures.map((e) => e.contentHash).filter((h): h is string => Boolean(h)),
    );
    for (const h of hashes) {
      for (const peer of byHash.get(h) ?? []) {
        if (peer.id !== s.id) {
          if (!reasons.includes("same-content-hash")) reasons.push("same-content-hash");
          siblingMap.set(peer.id, peer.name);
        }
      }
    }

    const norm = s.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    for (const peer of byNormName.get(norm) ?? []) {
      if (peer.id !== s.id) {
        if (!reasons.includes("same-normalized-name")) reasons.push("same-normalized-name");
        siblingMap.set(peer.id, peer.name);
      }
    }

    if (physicalCopies > 1) {
      reasons.push("multiple-physical-copies");
    }

    if (reasons.length === 0) return s;

    const duplicates: DuplicateInfo = {
      reasons,
      siblingIds: Array.from(siblingMap.keys()),
      siblingNames: Array.from(siblingMap.values()),
      physicalCopies,
    };

    if (siblingMap.size > 0) {
      const existing = s.driftDetails;
      const nextReasons: DriftReason[] = existing
        ? existing.reasons.includes("duplicate-source")
          ? [...existing.reasons]
          : [...existing.reasons, "duplicate-source"]
        : ["duplicate-source"];
      const siblingSummary = `duplicated in ${siblingMap.size} other skill/source(s)`;
      const driftDetails: DriftDetails = existing
        ? {
            ...existing,
            reasons: nextReasons,
            summary: existing.summary.includes("duplicated")
              ? existing.summary
              : `${existing.summary} · ${siblingSummary}`,
          }
        : {
            reasons: nextReasons,
            summary: siblingSummary,
            hasGlobalAndProject: false,
            distinctHashes: hashes.size,
            physicalCopies,
            managers: [s.provenance.owningManager],
            unmanagedPaths: [],
            copies: s.exposures.map((e) => ({
              path: e.path,
              scope: e.scope,
              harnessId: e.harnessId,
              linkType: e.linkType,
              ...(e.contentHash ? { contentHash: e.contentHash } : {}),
              manager: s.provenance.owningManager,
              isUnmanaged:
                s.provenance.owningManager === "manual" ||
                s.provenance.owningManager === "git-clone",
              ...(e.modifiedAt ? { modifiedAt: e.modifiedAt } : {}),
              ...(e.version ? { version: e.version } : {}),
            })),
          };
      return { ...s, duplicates, hasDrift: true, driftDetails };
    }

    return { ...s, duplicates };
  });
}
