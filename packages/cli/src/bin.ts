#!/usr/bin/env node
import type { DryRunPreview } from "@harness-control/core";
import { startDaemon } from "@harness-control/server";
import { Command } from "commander";
import {
  connectOrStartDaemon,
  getDaemonStatus,
  restartDaemon,
  stopDaemon,
} from "./daemon-bridge.js";
import { launchTui } from "./tui.js";

function printPreview(preview: DryRunPreview): void {
  console.log(`\nDRY-RUN PREVIEW: ${preview.summary}`);
  if (preview.commands.length > 0) {
    console.log("Commands:");
    for (const c of preview.commands) {
      console.log(`  $ ${c.command} ${c.args.join(" ")}${c.cwd ? ` (cwd: ${c.cwd})` : ""}`);
    }
  }
  if (preview.pathChanges.length > 0) {
    console.log("Path changes:");
    for (const p of preview.pathChanges) {
      console.log(`  [${p.operation}] ${p.path}${p.target ? ` -> ${p.target}` : ""}`);
    }
  }
  if (preview.warnings.length > 0) {
    console.log("Warnings:");
    for (const w of preview.warnings) console.log(`  ! ${w}`);
  }
}

const program = new Command();
program
  .name("harness-control")
  .description("Unified visibility dashboard and orchestration wrapper across AI coding harnesses")
  .version("0.3.0");

program
  .command("serve")
  .description("Run the local harness-control daemon in the foreground")
  .option("-p, --port <port>", "Port to listen on", "4318")
  .action(async (opts: { port: string }) => {
    await startDaemon(Number(opts.port));
  });

const daemonCmd = program
  .command("daemon")
  .description("Control the background harness-control daemon");

daemonCmd
  .command("start")
  .description("Start the background daemon if not already running")
  .option("-f, --foreground", "Run in the foreground instead of detaching")
  .option("-p, --port <port>", "Port to listen on (foreground only)", "4318")
  .action(async (opts: { foreground?: boolean; port: string }) => {
    if (opts.foreground) {
      await startDaemon(Number(opts.port));
      return;
    }
    const existing = await getDaemonStatus();
    if (existing) {
      console.log(`Daemon already running (pid ${existing.pid}, port ${existing.port}).`);
      return;
    }
    const client = await connectOrStartDaemon();
    const st = await client.getStatus();
    console.log(
      st
        ? `Started harness-controld (pid ${st.pid}, port ${st.port}).`
        : "Started harness-controld.",
    );
  });

daemonCmd
  .command("stop")
  .description("Gracefully stop the background daemon (SIGTERM)")
  .action(async () => {
    const { stoppedPids } = await stopDaemon(false);
    if (stoppedPids.length === 0) {
      console.log("Daemon is not running.");
      return;
    }
    console.log(`Stopped harness-controld (pid ${stoppedPids.join(", ")}).`);
  });

daemonCmd
  .command("kill")
  .description("Force-kill the background daemon (SIGKILL)")
  .action(async () => {
    const { stoppedPids } = await stopDaemon(true);
    if (stoppedPids.length === 0) {
      console.log("Daemon is not running.");
      return;
    }
    console.log(`Killed harness-controld (pid ${stoppedPids.join(", ")}).`);
  });

daemonCmd
  .command("restart")
  .description("Restart the background daemon")
  .action(async () => {
    const st = await restartDaemon();
    if (st) {
      console.log(`Restarted harness-controld (pid ${st.pid}, port ${st.port}).`);
    } else {
      console.log("Restarted harness-controld.");
    }
  });

daemonCmd
  .command("status")
  .description("Check background daemon status")
  .action(async () => {
    const st = await getDaemonStatus();
    if (!st) {
      console.log("Daemon: OFFLINE");
      process.exitCode = 1;
      return;
    }
    console.log(`Daemon: ONLINE (pid ${st.pid}, port ${st.port}, uptime ${st.uptimeSeconds}s)`);
  });

program
  .command("tui", { isDefault: true })
  .description("Launch the interactive terminal UI")
  .action(async () => {
    const client = await connectOrStartDaemon();
    await launchTui(client);
  });

program
  .command("list")
  .description("List discovered skills across harnesses and projects")
  .option("--json", "Output JSON")
  .option("--refresh", "Force a fresh scan")
  .option("--harness <id>", "Filter by harness ID")
  .option("--author <name>", "Filter by author")
  .option("--broken", "Only show skills with broken symlinks")
  .option("--drift", "Only show skills with project drift")
  .option("--updates", "Only show skills with upstream updates available")
  .option("--sort <field>", "Sort by: name | desc | full | projects", "name")
  .action(
    async (opts: {
      json?: boolean;
      refresh?: boolean;
      harness?: string;
      author?: string;
      broken?: boolean;
      drift?: boolean;
      updates?: boolean;
      sort?: string;
    }) => {
      const client = await connectOrStartDaemon();
      const res = await client.getInventory(Boolean(opts.refresh));
      let skills = [...res.snapshot.skills];
      if (opts.harness) {
        skills = skills.filter((s) => s.exposures.some((e) => e.harnessId === opts.harness));
      }
      if (opts.author) {
        skills = skills.filter(
          (s) => s.provenance.author.toLowerCase() === opts.author!.toLowerCase(),
        );
      }
      if (opts.broken) skills = skills.filter((s) => s.hasBrokenLinks);
      if (opts.drift) skills = skills.filter((s) => s.hasDrift);
      if (opts.updates) skills = skills.filter((s) => s.provenance.updateStatus.updateAvailable);

      skills.sort((a, b) => {
        switch (opts.sort) {
          case "desc":
            return b.tokens.descriptionTokens - a.tokens.descriptionTokens;
          case "full":
            return b.tokens.fullTokens - a.tokens.fullTokens;
          case "projects":
            return b.projectCount - a.projectCount;
          default:
            return a.name.localeCompare(b.name);
        }
      });

      if (opts.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (skills.length === 0) {
        console.log("No skills matched the specified filters.");
        return;
      }
      let sumDesc = 0;
      let sumFull = 0;
      for (const s of skills) {
        sumDesc += s.tokens.descriptionTokens;
        sumFull += s.tokens.fullTokens;
        const harnesses = Array.from(new Set(s.exposures.map((e) => e.harnessId))).join(",");
        const flags = `${s.hasBrokenLinks ? " [BROKEN]" : ""}${s.hasDrift ? " [DRIFT]" : ""}`;
        console.log(
          `${s.id.slice(0, 32).padEnd(33)} ${s.provenance.owningManager.padEnd(15)} desc:${String(s.tokens.descriptionTokens).padStart(4)}t full:${String(s.tokens.fullTokens).padStart(5)}t proj:${String(s.projectCount).padStart(2)} [${harnesses}]${flags}`,
        );
      }
      console.log(`\nTotal: ${skills.length} skill(s) | desc=${sumDesc}t | full=${sumFull}t`);
    },
  );

program
  .command("tokens")
  .description("Show multi-level token usage (global, per-harness, per-author)")
  .option("--json", "Output JSON")
  .action(async (opts: { json?: boolean }) => {
    const client = await connectOrStartDaemon();
    const { telemetry } = await client.getInventory(false);
    if (opts.json) {
      console.log(JSON.stringify(telemetry, null, 2));
      return;
    }
    console.log(
      `Global: ${telemetry.totalUniqueSkills} skills | desc=${telemetry.totalTokens.descriptionTokens}t | full=${telemetry.totalTokens.fullTokens}t`,
    );
    console.log(
      `Projects: ${telemetry.byProject.length} workspace(s) | desc=${telemetry.projectTokens.descriptionTokens}t | full=${telemetry.projectTokens.fullTokens}t`,
    );
    console.log("\nBy Harness (Global):");
    for (const h of telemetry.byHarness) {
      console.log(
        `  ${h.harnessId.padEnd(18)} skills=${String(h.skillCount).padStart(3)} desc=${String(h.tokens.descriptionTokens).padStart(5)}t full=${String(h.tokens.fullTokens).padStart(6)}t`,
      );
    }
    console.log("\nHeaviest Projects:");
    for (const p of telemetry.byProject.slice(0, 10)) {
      console.log(
        `  ${p.projectRoot.slice(-40).padEnd(41)} skills=${String(p.skillCount).padStart(3)} desc=${String(p.tokens.descriptionTokens).padStart(5)}t full=${String(p.tokens.fullTokens).padStart(6)}t`,
      );
    }
    console.log("\nBy Source:");
    for (const a of telemetry.byAuthor) {
      console.log(
        `  ${a.author.padEnd(22)} skills=${String(a.skillCount).padStart(3)} desc=${String(a.tokens.descriptionTokens).padStart(5)}t full=${String(a.tokens.fullTokens).padStart(6)}t`,
      );
    }
  });

program
  .command("sources")
  .description("List skills grouped by source (installed, available, deprecated)")
  .option("--json", "Output JSON")
  .option("--source <name>", "Filter by author, repo, or marketplace")
  .action(async (opts: { json?: boolean; source?: string }) => {
    const client = await connectOrStartDaemon();
    const res = await client.getInventory(false);
    let sources = res.sources;
    if (opts.source) {
      const q = opts.source.toLowerCase();
      sources = sources.filter(
        (s) =>
          s.author.toLowerCase().includes(q) ||
          (s.sourceRepo ?? "").toLowerCase().includes(q) ||
          (s.marketplaceName ?? "").toLowerCase().includes(q),
      );
    }
    if (opts.json) {
      console.log(JSON.stringify(sources, null, 2));
      return;
    }
    for (const src of sources) {
      console.log(
        `\n${src.marketplaceName ?? src.sourceRepo ?? src.author} [${src.owningManager}] (installed:${src.installedCount} available:${src.availableCount} deprecated:${src.deprecatedCount})`,
      );
      for (const sk of src.skills) {
        const tag =
          sk.lifecycle === "installed"
            ? "[INSTALLED]"
            : sk.lifecycle === "available"
              ? "[AVAILABLE]"
              : `[DEPRECATED${sk.replacedBy ? ` -> ${sk.replacedBy}` : ""}]`;
        console.log(`  ${tag.padEnd(20)} ${sk.name}`);
      }
    }
  });

program
  .command("remove <skillId>")
  .description("Preview or execute removal of a skill via its owning manager")
  .option("-y, --yes", "Execute after preview")
  .action(async (skillId: string, opts: { yes?: boolean }) => {
    const client = await connectOrStartDaemon();
    const req = { skillId, confirmUnmanaged: Boolean(opts.yes) };
    const preview = await client.previewRemove(req);
    printPreview(preview);
    if (!opts.yes) {
      console.log("\nDry-run only. Re-run with --yes to execute.");
      return;
    }
    const result = await client.executeRemove(req);
    console.log(result.success ? "Removed." : `Errors: ${result.errors.join("; ")}`);
    process.exitCode = result.success ? 0 : 1;
  });

program
  .command("upgrade [skillId]")
  .description("Preview or execute upgrades (all, by author, or single skill)")
  .option("--all", "Upgrade all skills")
  .option("--author <name>", "Upgrade all skills by author")
  .option("-y, --yes", "Execute after preview")
  .action(
    async (
      skillId: string | undefined,
      opts: { all?: boolean; author?: string; yes?: boolean },
    ) => {
      const client = await connectOrStartDaemon();
      const scope = opts.all ? "all" : opts.author ? "author" : "skill";
      const req = {
        scope,
        ...(opts.author ? { author: opts.author } : {}),
        ...(skillId ? { skillId } : {}),
      } as const;
      const preview = await client.previewUpgrade(req);
      printPreview(preview);
      if (!opts.yes) {
        console.log("\nDry-run only. Re-run with --yes to execute.");
        return;
      }
      const result = await client.executeUpgrade(req);
      console.log(result.success ? "Upgraded." : `Errors: ${result.errors.join("; ")}`);
      process.exitCode = result.success ? 0 : 1;
    },
  );

program
  .command("migrate-apm <skillIds...>")
  .description("Migrate selected skills to declarative APM dependencies")
  .option("--cleanup", "Clean up legacy lockfiles/copies")
  .option("-y, --yes", "Execute after preview")
  .action(async (skillIds: string[], opts: { cleanup?: boolean; yes?: boolean }) => {
    const client = await connectOrStartDaemon();
    const req = { skillIds, cleanupLegacyLockfiles: Boolean(opts.cleanup) };
    const preview = await client.previewMigrateToApm(req);
    printPreview(preview);
    if (!opts.yes) {
      console.log("\nDry-run only. Re-run with --yes to execute.");
      return;
    }
    const result = await client.executeMigrateToApm(req);
    console.log(result.success ? "Migrated." : `Errors: ${result.errors.join("; ")}`);
    process.exitCode = result.success ? 0 : 1;
  });

program
  .command("repair-link <brokenPath> <newTarget>")
  .description("Repair a dangling symlink")
  .option("-y, --yes", "Execute after preview")
  .action(async (brokenPath: string, newTarget: string, opts: { yes?: boolean }) => {
    const client = await connectOrStartDaemon();
    const req = { brokenPath, newTargetPath: newTarget };
    const preview = await client.previewRepairLink(req);
    printPreview(preview);
    if (!opts.yes) {
      console.log("\nDry-run only. Re-run with --yes to execute.");
      return;
    }
    const result = await client.executeRepairLink(req);
    console.log(result.success ? "Repaired." : `Errors: ${result.errors.join("; ")}`);
    process.exitCode = result.success ? 0 : 1;
  });

program
  .command("cleanup")
  .description("Analyze duplicates, drift, unused, untracked, and broken skills")
  .option(
    "--only <categories>",
    "Comma-separated categories: duplicates,drift,unused,untracked,broken,outdated",
  )
  .option("-y, --yes", "Execute queued manager commands after preview")
  .action(async (opts: { only?: string; yes?: boolean }) => {
    const client = await connectOrStartDaemon();
    const { candidates } = await client.getCleanupPlan(false);
    const allowed = opts.only
      ? new Set(
          opts.only
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
      : null;
    const filtered = candidates.filter(
      (c) => (!allowed || allowed.has(c.category)) && c.recommendedAction !== "skip",
    );
    const queue = filtered.map((c) => ({
      skillId: c.skillId,
      category: c.category,
      action: c.recommendedAction,
      ...(c.recommendedAction === "remove" ? { targetScope: c.recommendedScope } : {}),
    }));
    const preview = await client.previewCleanup(queue);
    const { impact } = preview;

    console.log(
      `Cleanup Plan: ${candidates.length} total candidates · ${impact.selectedCount} actionable`,
    );
    console.log(
      `  Duplicates: ${impact.byCategorySelected.duplicates} | Drift: ${impact.byCategorySelected.drift} | Unused: ${impact.byCategorySelected.unused} | Untracked: ${impact.byCategorySelected.untracked} | Broken: ${impact.byCategorySelected.broken} | Outdated: ${impact.byCategorySelected.outdated}`,
    );
    console.log(
      `  Expected Result: ${impact.removeCount} remove, ${impact.migrateCount} migrate, ${impact.upgradeCount} upgrade · -${impact.tokensSavedDesc} desc (-${impact.tokensSavedDescPct}%), -${impact.tokensSavedFull} full (-${impact.tokensSavedFullPct}%)`,
    );
    if (preview.commands.length > 0) {
      console.log("\nPlanned manager commands:");
      for (const cmd of preview.commands) {
        console.log(
          `  $ ${cmd.command} ${cmd.args.join(" ")}${cmd.cwd ? ` (cwd: ${cmd.cwd})` : ""}`,
        );
      }
    }
    if (preview.warnings.length > 0) {
      console.log(`\nWarnings (${preview.warnings.length}):`);
      for (const w of preview.warnings.slice(0, 5)) console.log(`  ! ${w}`);
    }

    if (!opts.yes) {
      console.log("\nDry-run only. Re-run with --yes to execute.");
      return;
    }
    const result = await client.executeCleanup(queue);
    console.log(result.success ? "Cleanup executed." : `Errors: ${result.errors.join("; ")}`);
    process.exitCode = result.success ? 0 : 1;
  });

await program.parseAsync(process.argv);
