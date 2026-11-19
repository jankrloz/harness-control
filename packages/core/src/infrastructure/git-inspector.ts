import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitInspectorPort, GitRepoInfo } from "../application/index.js";

const execFileAsync = promisify(execFile);

async function gitExec(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      timeout: 4000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function parseCanonicalAuthor(remoteUrl: string): string | undefined {
  const match = remoteUrl.match(/[:/]([^/]+)\/[^/]+?(?:\.git)?$/);
  return match?.[1];
}

export class GitInspector implements GitInspectorPort {
  async inspectPath(targetPath: string, checkRemote: boolean): Promise<GitRepoInfo | null> {
    const topLevel = await gitExec(targetPath, ["rev-parse", "--show-toplevel"]);
    if (!topLevel) return null;

    const [remoteUrl, currentCommit] = await Promise.all([
      gitExec(topLevel, ["config", "--get", "remote.origin.url"]),
      gitExec(topLevel, ["rev-parse", "--short", "HEAD"]),
    ]);

    let latestCommit: string | undefined;
    let updateAvailable = false;

    if (checkRemote && remoteUrl && currentCommit) {
      const lsRemote = await gitExec(topLevel, ["ls-remote", "origin", "HEAD"]);
      const remoteHead = lsRemote?.split(/\s+/)[0]?.slice(0, currentCommit.length);
      if (remoteHead) {
        latestCommit = remoteHead;
        updateAvailable = remoteHead !== currentCommit;
      }
    }

    const canonicalAuthor = remoteUrl ? parseCanonicalAuthor(remoteUrl) : undefined;

    return {
      ...(remoteUrl ? { remoteUrl, sourceRepo: remoteUrl } : {}),
      ...(canonicalAuthor ? { canonicalAuthor } : {}),
      ...(currentCommit ? { currentCommit } : {}),
      updateStatus: {
        ...(currentCommit ? { currentCommit } : {}),
        ...(latestCommit ? { latestCommit } : {}),
        updateAvailable,
        checkedAt: new Date().toISOString(),
      },
    };
  }
}
