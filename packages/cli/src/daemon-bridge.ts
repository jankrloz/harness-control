import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient, DEFAULT_DAEMON_PORT } from "@harness-control/server";

const DEFAULT_URL = process.env["HARNESS_MANAGER_URL"] ?? `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`;

async function waitForHealth(client: DaemonClient, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.health()) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

export async function connectOrStartDaemon(): Promise<DaemonClient> {
  const client = new DaemonClient(DEFAULT_URL);
  if (await client.health()) {
    return client;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const daemonEntry = path.resolve(here, "../../server/dist/daemon.js");
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
