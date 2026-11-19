export type PackageManager =
  | "apm"
  | "npx-skills"
  | "claude-plugin"
  | "antigravity-plugin"
  | "gemini-extension"
  | "git-clone"
  | "manual";

export interface UpdateStatus {
  readonly currentVersion?: string;
  readonly currentCommit?: string;
  readonly latestVersion?: string;
  readonly latestCommit?: string;
  readonly updateAvailable: boolean;
  readonly checkedAt?: string;
}

export interface Provenance {
  readonly author: string;
  readonly sourceRepo?: string;
  readonly owningManager: PackageManager;
  readonly managedId?: string;
  readonly updateStatus: UpdateStatus;
}
