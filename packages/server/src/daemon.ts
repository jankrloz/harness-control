import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServerApp } from "./app.js";

export const DEFAULT_DAEMON_PORT = 4318;
export const DEFAULT_DAEMON_HOST = "127.0.0.1";

function daemonStatePath(): string {
  const xdg = process.env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
  return path.join(xdg, "harness-control", "daemon.json");
}

export async function startDaemon(
  port = Number(process.env["HARNESS_CONTROL_PORT"] ?? DEFAULT_DAEMON_PORT),
): Promise<void> {
  const app = createServerApp();
  const stateFile = daemonStatePath();

  const server = serve({ fetch: app.fetch, hostname: DEFAULT_DAEMON_HOST, port }, async (info) => {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(
      stateFile,
      JSON.stringify(
        {
          pid: process.pid,
          host: DEFAULT_DAEMON_HOST,
          port: info.port,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`harness-controld listening on http://${DEFAULT_DAEMON_HOST}:${info.port}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use (another harness-controld may be running). Run 'task daemon:stop' first or set HARNESS_CONTROL_PORT.`,
      );
      process.exit(1);
    }
    throw err;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startDaemon();
}
