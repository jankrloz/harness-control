import type { HarnessId } from "@harness-control/core";
import {
  ClaudeCode,
  CodexOpenai,
  Cursor,
  Deepseek,
  GeminiCli,
  GithubCopilot,
  GoogleAntigravity,
  Grok,
  Hermes,
  Kiro,
  Openclaw,
  Opencode,
  type SvgIconProps,
  Windsurf,
} from "@thesvg/react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";

type BrandIcon = ForwardRefExoticComponent<SvgIconProps & RefAttributes<SVGSVGElement>>;

interface HarnessIconProps {
  readonly harnessId: HarnessId;
  readonly size?: number;
}

const BRAND_ICONS: Record<string, BrandIcon> = {
  claude: ClaudeCode,
  codex: CodexOpenai,
  gemini: GeminiCli,
  antigravity: GoogleAntigravity,
  cursor: Cursor,
  copilot: GithubCopilot,
  "copilot-app": GithubCopilot,
  "copilot-cowork": GithubCopilot,
  opencode: Opencode,
  windsurf: Windsurf,
  deepseek: Deepseek,
  "grok-bot": Grok,
  "grok-build": Grok,
  "grok-cloud": Grok,
  hermes: Hermes,
  kiro: Kiro,
  openclaw: Openclaw,
};

const SHORT_LABELS: Record<string, string> = {
  pi: "PI",
};

export function HarnessIcon({ harnessId, size = 14 }: HarnessIconProps) {
  const Icon = BRAND_ICONS[harnessId];
  if (Icon) {
    return (
      <Icon
        width={size}
        height={size}
        aria-hidden="true"
        style={{ flexShrink: 0, display: "inline-block" }}
      />
    );
  }

  const label = SHORT_LABELS[harnessId] ?? harnessId.slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 3,
        border: "1px solid currentColor",
        fontSize: Math.max(7, Math.floor(size * 0.56)),
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
