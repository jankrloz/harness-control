import type { PrimitiveKind } from "./primitive.js";

export type BuiltinHarnessId =
  | "claude"
  | "copilot-app"
  | "copilot-cowork"
  | "gemini"
  | "grok-bot"
  | "grok-build"
  | "grok-cloud"
  | "hermes"
  | "kiro"
  | "openclaw"
  | "pi"
  | "deepseek"
  | "antigravity"
  | "codex"
  | "copilot"
  | "cursor"
  | "opencode"
  | "windsurf";

export type HarnessId = BuiltinHarnessId | (string & {});

export type HarnessSupportLevel = "full" | "partial" | "custom";

export interface HarnessDefinition {
  readonly id: HarnessId;
  readonly displayName: string;
  readonly supportLevel: HarnessSupportLevel;
  readonly globalSkillDirs: readonly string[];
  readonly projectSkillDirs: readonly string[];
  readonly cliBinary?: string;
  readonly listCommand?: readonly string[];
  readonly supportedPrimitives: readonly PrimitiveKind[];
}
