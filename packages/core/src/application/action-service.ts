import type {
  ActionResult,
  CommandExecutionRecord,
  DryRunPreview,
  InstallSkillRequest,
  MigrateToApmRequest,
  PlannedCommand,
  PlannedPathChange,
  RemoveSkillRequest,
  RepairLinkRequest,
  SkillRecord,
  UpgradeRequest,
} from "../domain/index.js";
import type { CommandExecutorPort } from "./ports.js";

export class ActionService {
  constructor(private readonly executor: CommandExecutorPort) {}

  previewInstall(req: InstallSkillRequest): DryRunPreview {
    const commands: PlannedCommand[] = [];
    const warnings: string[] = [];

    if (req.scope === "project" && !req.projectPath) {
      warnings.push("Project path is required for project-level installation.");
    }

    if (req.manager === "npx-skills") {
      const args = ["skills", "add", req.source, "-s", req.skillName];
      if (req.scope === "global") args.push("-g");
      args.push("-y");
      commands.push({
        command: "npx",
        args,
        ...(req.scope === "project" && req.projectPath ? { cwd: req.projectPath } : {}),
        description: `Install '${req.skillName}' (${req.scope}) via npx skills`,
      });
    } else {
      const args = ["install", req.source];
      if (req.scope === "global") args.push("-g");
      commands.push({
        command: "apm",
        args,
        ...(req.scope === "project" && req.projectPath ? { cwd: req.projectPath } : {}),
        description: `Install '${req.source}' (${req.scope}) via APM`,
      });
    }

    return {
      action: "install",
      summary: `Install '${req.skillName}' via ${req.manager} (${req.scope})`,
      targetSkillIds: [],
      commands,
      pathChanges: [],
      warnings,
    };
  }

  async executeInstall(req: InstallSkillRequest): Promise<ActionResult> {
    const preview = this.previewInstall(req);
    if (req.scope === "project" && !req.projectPath) {
      return {
        action: "install",
        success: false,
        preview,
        executedCommands: [],
        errors: ["Project path is required for project-level installation."],
      };
    }
    return this.executePreview(preview);
  }

  private appendRemoveCommandsForSkill(
    skill: SkillRecord,
    req: RemoveSkillRequest,
    commands: PlannedCommand[],
    warnings: string[],
    seenCommands: Set<string>,
  ): void {
    const pushUnique = (cmd: PlannedCommand) => {
      const key = `${cmd.command}:${cmd.args.join(" ")}:${cmd.cwd ?? ""}`;
      if (seenCommands.has(key)) return;
      seenCommands.add(key);
      commands.push(cmd);
    };

    const targetExposure = req.exposurePath
      ? skill.exposures.find((e) => e.path === req.exposurePath)
      : undefined;

    let removeGlobal = false;
    let removeProjects: readonly string[] = [];

    if (targetExposure) {
      if (targetExposure.scope === "global") {
        removeGlobal = true;
      } else if (targetExposure.projectRoot) {
        removeProjects = [targetExposure.projectRoot];
      }
    } else {
      const targetScope = req.targetScope ?? "all";
      const hasGlobal =
        skill.exposures.some((e) => e.scope === "global") || skill.projectPaths.length === 0;
      removeGlobal = (targetScope === "all" || targetScope === "global") && hasGlobal;
      if (targetScope === "all" || targetScope === "project") {
        removeProjects = skill.projectPaths;
      } else if (targetScope === "selected-projects") {
        const selected = new Set(req.projectPaths ?? []);
        removeProjects = skill.projectPaths.filter((p) => selected.has(p));
      }
    }

    if (!removeGlobal && removeProjects.length === 0) {
      return;
    }

    const targetId = skill.provenance.managedId ?? skill.name;
    switch (skill.provenance.owningManager) {
      case "apm": {
        if (removeGlobal) {
          pushUnique({
            command: "apm",
            args: ["uninstall", targetId, "-g"],
            description: `Uninstall '${targetId}' (global) via APM`,
          });
        }
        for (const projectRoot of removeProjects) {
          pushUnique({
            command: "apm",
            args: ["uninstall", targetId],
            cwd: projectRoot,
            description: `Uninstall '${targetId}' in ${projectRoot} via APM`,
          });
        }
        break;
      }
      case "npx-skills": {
        if (removeGlobal) {
          pushUnique({
            command: "npx",
            args: ["skills", "remove", targetId, "-g", "-y"],
            description: `Remove '${targetId}' (global) via npx skills`,
          });
        }
        for (const projectRoot of removeProjects) {
          pushUnique({
            command: "npx",
            args: ["skills", "remove", targetId, "-y"],
            cwd: projectRoot,
            description: `Remove '${targetId}' in ${projectRoot} via npx skills`,
          });
        }
        break;
      }
      case "claude-plugin":
        pushUnique({
          command: "claude",
          args: ["plugin", "uninstall", targetId],
          description: `Uninstall '${targetId}' via Claude CLI`,
        });
        break;
      case "gemini-extension":
        pushUnique({
          command: "gemini",
          args: ["extensions", "uninstall", targetId],
          description: `Uninstall '${targetId}' via Gemini CLI`,
        });
        break;
      case "antigravity-plugin":
        warnings.push(
          `Antigravity plugin '${targetId}' must be uninstalled via Antigravity Plugins Manager. Direct file deletion (rm) is disabled.`,
        );
        break;
      case "git-clone":
      case "manual":
        warnings.push(
          `'${skill.name}' is ${skill.provenance.owningManager} with no CLI manager command. Direct file deletion (rm) is disabled; migrate to APM or remove manually.`,
        );
        break;
    }
  }

  previewRemove(skills: readonly SkillRecord[], req: RemoveSkillRequest): DryRunPreview {
    const targets =
      req.scope === "author" && req.author
        ? skills.filter((s) => s.provenance.author.toLowerCase() === req.author!.toLowerCase())
        : skills.filter((s) => s.id === req.skillId);

    if (targets.length === 0) {
      const label = req.scope === "author" ? `source '${req.author}'` : `'${req.skillId}'`;
      return {
        action: "remove",
        summary: `No skills found for ${label}`,
        targetSkillIds: [],
        commands: [],
        pathChanges: [],
        warnings: [`No matching skills found for ${label} in inventory.`],
      };
    }

    const commands: PlannedCommand[] = [];
    const warnings: string[] = [];
    const seenCommands = new Set<string>();

    for (const skill of targets) {
      this.appendRemoveCommandsForSkill(skill, req, commands, warnings, seenCommands);
    }

    return {
      action: "remove",
      summary:
        req.scope === "author"
          ? `Remove ${targets.length} skill(s) from source '${req.author}'`
          : `Remove skill '${targets[0]!.name}' (${targets[0]!.provenance.owningManager})`,
      targetSkillIds: targets.map((t) => t.id),
      commands,
      pathChanges: [],
      warnings,
    };
  }

  async executeRemove(
    skills: readonly SkillRecord[],
    req: RemoveSkillRequest,
  ): Promise<ActionResult> {
    const preview = this.previewRemove(skills, req);
    if (preview.targetSkillIds.length > 0 && preview.commands.length === 0) {
      return {
        action: "remove",
        success: false,
        preview,
        executedCommands: [],
        errors: [
          "No CLI manager command available for the selected skill(s). Direct file deletion ('rm') is disabled.",
        ],
      };
    }
    return this.executePreview(preview);
  }

  previewUpgrade(skills: readonly SkillRecord[], req: UpgradeRequest): DryRunPreview {
    const targets = skills.filter((s) => {
      if (req.scope === "all") return true;
      if (req.scope === "author")
        return s.provenance.author.toLowerCase() === (req.author ?? "").toLowerCase();
      return s.id === req.skillId;
    });

    const commands: PlannedCommand[] = [];
    const warnings: string[] = [];
    const seenManagerBatches = new Set<string>();

    for (const skill of targets) {
      const targetId = skill.provenance.managedId ?? skill.name;
      switch (skill.provenance.owningManager) {
        case "apm": {
          const key = req.scope === "all" ? "apm:all" : `apm:${targetId}`;
          if (!seenManagerBatches.has(key)) {
            seenManagerBatches.add(key);
            commands.push({
              command: "apm",
              args: req.scope === "all" ? ["update"] : ["update", targetId],
              description: `Upgrade ${req.scope === "all" ? "all APM packages" : targetId} via APM`,
            });
          }
          break;
        }
        case "npx-skills": {
          const key = req.scope === "all" ? "npx-skills:all" : `npx-skills:${targetId}`;
          if (!seenManagerBatches.has(key)) {
            seenManagerBatches.add(key);
            commands.push({
              command: "npx",
              args:
                req.scope === "all"
                  ? ["skills", "update", "-y"]
                  : ["skills", "update", targetId, "-y"],
              description: `Upgrade ${req.scope === "all" ? "all npx skills" : targetId}`,
            });
          }
          break;
        }
        case "claude-plugin":
          commands.push({
            command: "claude",
            args: ["plugin", "update", targetId],
            description: `Update Claude plugin '${targetId}'`,
          });
          break;
        case "gemini-extension":
          commands.push({
            command: "gemini",
            args: ["extensions", "update", targetId],
            description: `Update Gemini extension '${targetId}'`,
          });
          break;
        case "git-clone":
        case "antigravity-plugin":
        case "manual":
          warnings.push(
            `Skipping '${skill.name}' (${skill.provenance.owningManager}): no CLI manager upgrade command (direct git pull is disabled).`,
          );
          break;
      }
    }

    return {
      action: "upgrade",
      summary: `Upgrade ${targets.length} skill(s) (scope=${req.scope})`,
      targetSkillIds: targets.map((t) => t.id),
      commands,
      pathChanges: [],
      warnings,
    };
  }

  async executeUpgrade(skills: readonly SkillRecord[], req: UpgradeRequest): Promise<ActionResult> {
    const preview = this.previewUpgrade(skills, req);
    return this.executePreview(preview);
  }

  previewMigrateToApm(skills: readonly SkillRecord[], req: MigrateToApmRequest): DryRunPreview {
    const targets = skills.filter((s) => req.skillIds.includes(s.id));
    const commands: PlannedCommand[] = [];
    const pathChanges: PlannedPathChange[] = [];
    const warnings: string[] = [];

    for (const skill of targets) {
      if (skill.provenance.owningManager === "apm") {
        warnings.push(`'${skill.name}' is already managed by APM.`);
        continue;
      }
      const source = skill.provenance.sourceRepo ?? skill.provenance.managedId ?? skill.name;
      commands.push({
        command: "apm",
        args: ["install", source],
        description: `Declare and install '${source}' via APM`,
      });
      if (req.cleanupLegacyLockfiles && skill.provenance.owningManager === "npx-skills") {
        commands.push({
          command: "npx",
          args: ["skills", "remove", skill.provenance.managedId ?? skill.name, "-y"],
          description: `Clean up legacy npx skills entry for '${skill.name}'`,
        });
      }
      if (
        skill.provenance.owningManager === "git-clone" ||
        skill.provenance.owningManager === "manual"
      ) {
        warnings.push(
          `'${skill.name}' has legacy ${skill.provenance.owningManager} exposure(s); direct file deletion (rm) is disabled, clean up manually if desired.`,
        );
      }
    }

    return {
      action: "migrate-to-apm",
      summary: `Migrate ${targets.length} skill(s) to APM`,
      targetSkillIds: targets.map((t) => t.id),
      commands,
      pathChanges,
      warnings,
    };
  }

  async executeMigrateToApm(
    skills: readonly SkillRecord[],
    req: MigrateToApmRequest,
  ): Promise<ActionResult> {
    const preview = this.previewMigrateToApm(skills, req);
    return this.executePreview(preview);
  }

  previewRepairLink(req: RepairLinkRequest): DryRunPreview {
    return {
      action: "repair-link",
      summary: `Repair broken symlink ${req.brokenPath} -> ${req.newTargetPath}`,
      targetSkillIds: [],
      commands: [],
      pathChanges: [
        {
          operation: "update-symlink",
          path: req.brokenPath,
          target: req.newTargetPath,
          reason: "Re-point dangling symlink to valid skill directory",
        },
      ],
      warnings: [],
    };
  }

  async executeRepairLink(req: RepairLinkRequest): Promise<ActionResult> {
    const preview = this.previewRepairLink(req);
    return this.executePreview(preview);
  }

  private async executePreview(preview: DryRunPreview): Promise<ActionResult> {
    const executedCommands: CommandExecutionRecord[] = [];
    const errors: string[] = [];

    for (const cmd of preview.commands) {
      const result = await this.executor.executeCommand(cmd);
      executedCommands.push(result);
      if (result.exitCode !== 0) {
        errors.push(
          `Command '${cmd.command} ${cmd.args.join(" ")}' failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
        );
      }
    }

    if (errors.length === 0) {
      for (const change of preview.pathChanges) {
        try {
          await this.executor.applyPathChange(change);
        } catch (err) {
          errors.push(
            `Path operation '${change.operation}' on '${change.path}' failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return {
      action: preview.action,
      success: errors.length === 0,
      preview,
      executedCommands,
      errors,
    };
  }
}
