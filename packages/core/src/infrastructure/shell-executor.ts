import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CommandExecutorPort } from "../application/index.js";
import type { CommandExecutionRecord, PlannedCommand, PlannedPathChange } from "../domain/index.js";

const execFileAsync = promisify(execFile);

export class ShellExecutor implements CommandExecutorPort {
  async executeCommand(cmd: PlannedCommand): Promise<CommandExecutionRecord> {
    try {
      const { stdout, stderr } = await execFileAsync(cmd.command, [...cmd.args], {
        ...(cmd.cwd ? { cwd: cmd.cwd } : {}),
        timeout: 60_000,
      });
      return {
        command: cmd.command,
        args: cmd.args,
        exitCode: 0,
        stdout,
        stderr,
      };
    } catch (err) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        command: cmd.command,
        args: cmd.args,
        exitCode: typeof execErr.code === "number" ? execErr.code : 1,
        stdout: execErr.stdout ?? "",
        stderr: execErr.stderr ?? execErr.message ?? "Command execution failed",
      };
    }
  }

  async applyPathChange(change: PlannedPathChange): Promise<void> {
    switch (change.operation) {
      case "delete":
        await fs.rm(change.path, { recursive: true, force: true });
        break;
      case "update-symlink":
        if (!change.target) {
          throw new Error(`Missing target for update-symlink on '${change.path}'`);
        }
        await fs.mkdir(path.dirname(change.path), { recursive: true });
        await fs.rm(change.path, { recursive: true, force: true });
        await fs.symlink(change.target, change.path);
        break;
      case "create-manifest":
      case "modify-manifest":
        throw new Error(`Manifest operation '${change.operation}' must be handled by owning CLI.`);
    }
  }
}
