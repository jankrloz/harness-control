import type {
  PackageManager,
  SkillLifecycleState,
  SkillRecord,
  SourceCatalogGroup,
  SourceSkillEntry,
} from "../domain/index.js";
import type { SourceCatalogPort, UpstreamSourceCatalog } from "./ports.js";

function sourceKeyForSkill(skill: SkillRecord): string {
  return skill.provenance.sourceRepo ?? skill.provenance.author ?? "unknown";
}

const LIFECYCLE_ORDER: Record<SkillLifecycleState, number> = {
  installed: 0,
  available: 1,
  deprecated: 2,
};

export class SourceCatalogService {
  constructor(private readonly catalogPort: SourceCatalogPort) {}

  async buildCatalog(
    installedSkills: readonly SkillRecord[],
    checkRemote: boolean,
  ): Promise<readonly SourceCatalogGroup[]> {
    const upstreamCatalogs = await this.catalogPort.discoverCatalogs(installedSkills, checkRemote);

    const groups = new Map<
      string,
      {
        sourceId: string;
        author: string;
        sourceRepo?: string;
        marketplaceName?: string;
        owningManager: PackageManager;
        installedByName: Map<string, SkillRecord>;
        upstream?: UpstreamSourceCatalog;
      }
    >();

    for (const skill of installedSkills) {
      const key = sourceKeyForSkill(skill);
      const existing = groups.get(key) ?? {
        sourceId: key,
        author: skill.provenance.author || "unknown",
        ...(skill.provenance.sourceRepo ? { sourceRepo: skill.provenance.sourceRepo } : {}),
        owningManager: skill.provenance.owningManager,
        installedByName: new Map<string, SkillRecord>(),
      };
      existing.installedByName.set(skill.name.toLowerCase(), skill);
      groups.set(key, existing);
    }

    for (const catalog of upstreamCatalogs) {
      const key = catalog.sourceRepo ?? catalog.sourceId;
      const existing = groups.get(key) ?? {
        sourceId: catalog.sourceId,
        author: catalog.author,
        ...(catalog.sourceRepo ? { sourceRepo: catalog.sourceRepo } : {}),
        ...(catalog.marketplaceName ? { marketplaceName: catalog.marketplaceName } : {}),
        owningManager: catalog.owningManager ?? "manual",
        installedByName: new Map<string, SkillRecord>(),
      };
      if (catalog.marketplaceName && !existing.marketplaceName) {
        existing.marketplaceName = catalog.marketplaceName;
      }
      existing.upstream = catalog;
      groups.set(key, existing);
    }

    const result: SourceCatalogGroup[] = [];

    for (const group of groups.values()) {
      const entries = new Map<string, SourceSkillEntry>();
      const upstreamByName = new Map(
        (group.upstream?.skills ?? []).map((u) => [u.name.toLowerCase(), u]),
      );

      for (const [lowerName, skill] of group.installedByName.entries()) {
        const up = upstreamByName.get(lowerName);
        const removedInLatest =
          Boolean(group.upstream?.catalogComplete) && upstreamByName.size > 0 && !up;
        const isDeprecated = Boolean(
          skill.metadata.deprecated || up?.deprecated || removedInLatest,
        );

        const deprecationReason =
          up?.deprecationReason ??
          skill.metadata.deprecationReason ??
          (removedInLatest ? "Removed from latest upstream source version" : undefined);
        const replacedBy = up?.replacedBy ?? skill.metadata.replacedBy;

        entries.set(lowerName, {
          name: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
          lifecycle: isDeprecated ? "deprecated" : "installed",
          installedSkillId: skill.id,
          ...(up?.pathInSource ? { pathInSource: up.pathInSource } : {}),
          ...(deprecationReason ? { deprecationReason } : {}),
          ...(replacedBy ? { replacedBy } : {}),
        });
      }

      for (const [lowerName, up] of upstreamByName.entries()) {
        if (entries.has(lowerName)) continue;
        entries.set(lowerName, {
          name: up.name,
          ...(up.description ? { description: up.description } : {}),
          lifecycle: up.deprecated ? "deprecated" : "available",
          ...(up.pathInSource ? { pathInSource: up.pathInSource } : {}),
          ...(up.deprecationReason ? { deprecationReason: up.deprecationReason } : {}),
          ...(up.replacedBy ? { replacedBy: up.replacedBy } : {}),
        });
      }

      const sortedSkills = Array.from(entries.values()).sort((a, b) => {
        const orderDiff = LIFECYCLE_ORDER[a.lifecycle] - LIFECYCLE_ORDER[b.lifecycle];
        return orderDiff !== 0 ? orderDiff : a.name.localeCompare(b.name);
      });

      result.push({
        sourceId: group.sourceId,
        author: group.author,
        ...(group.sourceRepo ? { sourceRepo: group.sourceRepo } : {}),
        ...(group.marketplaceName ? { marketplaceName: group.marketplaceName } : {}),
        owningManager: group.owningManager,
        installedCount: sortedSkills.filter((s) => s.lifecycle === "installed").length,
        availableCount: sortedSkills.filter((s) => s.lifecycle === "available").length,
        deprecatedCount: sortedSkills.filter((s) => s.lifecycle === "deprecated").length,
        skills: sortedSkills,
      });
    }

    return result.sort(
      (a, b) => b.installedCount - a.installedCount || a.author.localeCompare(b.author),
    );
  }
}
