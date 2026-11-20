import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient, type DaemonStatus, DEFAULT_DAEMON_PORT } from "@harness-control/server";

const DEFAULT_URL = process.env["HARNESS_MANAGER_URL"] ?? `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`;

async function waitForHealth(client: DaemonClient, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.health()) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

async function waitForDown(client: DaemonClient, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await client.health())) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function resolveDaemonEntry(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../server/dist/daemon.js"),
    path.resolve(here, "../node_modules/@harness-control/server/dist/daemon.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

async function findDaemonPids(client: DaemonClient): Promise<number[]> {
  try {
    const status = await client.getStatus();
    if (status?.pid) return [status.pid];
  } catch {
    // Fall back to lsof below if HTTP status is unreachable
  }
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${DEFAULT_DAEMON_PORT}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split(/\r?\n/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

export async function connectOrStartDaemon(): Promise<DaemonClient> {
  const client = new DaemonClient(DEFAULT_URL);
  if (await client.health()) {
    return client;
  }

  const daemonEntry = resolveDaemonEntry();
  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const ready = await waitForHealth(client);
  if (!ready) {
    throw new Error(`Failed to connect to or start harness-control daemon at ${DEFAULT_URL}`);
  }
  return client;
}

export async function getDaemonStatus(): Promise<DaemonStatus | null> {
  const client = new DaemonClient(DEFAULT_URL);
  try {
    return await client.getStatus();
  } catch {
    return null;
  }
}

export async function stopDaemon(forceKill = false): Promise<{ stoppedPids: number[] }> {
  const client = new DaemonClient(DEFAULT_URL);
  const pids = await findDaemonPids(client);
  if (pids.length === 0) return { stoppedPids: [] };

  const signal: NodeJS.Signals = forceKill ? "SIGKILL" : "SIGTERM";
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Ignore already exited
    }
  }
  await waitForDown(client);
  return { stoppedPids: pids };
}

export async function restartDaemon(): Promise<DaemonStatus | null> {
  await stopDaemon(false);
  const client = await connectOrStartDaemon();
  return client.getStatus().catch(() => null);
}
