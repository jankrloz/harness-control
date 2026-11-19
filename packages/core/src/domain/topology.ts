import type { HarnessId } from "./harness.js";
import type { Scope } from "./primitive.js";

export type LinkType = "symlink-healthy" | "symlink-broken" | "physical-copy";

export interface SkillExposure {
  readonly harnessId: HarnessId;
  readonly scope: Scope;
  readonly profile?: string;
  readonly path: string;
  readonly skillFilePath: string;
  readonly linkType: LinkType;
  readonly symlinkTarget?: string;
  readonly projectRoot?: string;
  readonly contentHash?: string;
  readonly modifiedAt?: string;
  readonly version?: string;
}
