import type { HarnessId } from "@harness-control/core";

interface HarnessIconProps {
  readonly harnessId: HarnessId;
  readonly size?: number;
}

const SHORT_LABELS: Record<string, string> = {
  claude: "CC",
  "copilot-app": "CA",
  "copilot-cowork": "CW",
  gemini: "GM",
  "grok-bot": "GB",
  "grok-build": "GD",
  "grok-cloud": "GC",
  hermes: "HM",
  kiro: "KR",
  openclaw: "OC",
  pi: "PI",
  deepseek: "DS",
  antigravity: "AG",
  codex: "CX",
  copilot: "CP",
  cursor: "CR",
  opencode: "OP",
  windsurf: "WS",
};

export function HarnessIcon({ harnessId, size = 14 }: HarnessIconProps) {
  switch (harnessId) {
    case "claude":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5v13M2.4 4.75l11.2 6.5M13.6 4.75l-11.2 6.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "codex":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M6.2 6.2L4.5 8l1.7 1.8M9.8 6.2L11.5 8l-1.7 1.8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "gemini":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5C8 5.2 10.8 8 14.5 8 10.8 8 8 10.8 8 14.5 8 10.8 5.2 8 1.5 8 5.2 8 8 5.2 8 1.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "antigravity":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3 13L8 2.5 13 13M5 9.5h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "cursor":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3 2.5L13 8l-4.5 1.2L7.3 13.5 3 2.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "copilot":
    case "copilot-app":
    case "copilot-cowork":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect
            x="2.5"
            y="4.5"
            width="11"
            height="7"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <circle cx="6" cy="8" r="1" fill="currentColor" />
          <circle cx="10" cy="8" r="1" fill="currentColor" />
        </svg>
      );
    case "opencode":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="11"
            height="11"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <rect x="5.5" y="5.5" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "windsurf":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 5.5c2-1.5 4-1.5 5.5 0s3.5 1.5 5.5 0M2.5 10.5c2-1.5 4-1.5 5.5 0s3.5 1.5 5.5 0"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "kiro":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M4 2.5v11M11.5 3.5L5.5 8l6 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "hermes":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3.5 3v10M12.5 3v10M3.5 8h9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "pi":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3 4.5h10M6 4.5v8M10 4.5v6.5c0 1 .5 1.5 1.5 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "openclaw":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M4 3.5L2.5 8 4 12.5M8 2.5v11M12 3.5L13.5 8 12 12.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "deepseek":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <polygon
            points="8,2 13.5,8 8,14 2.5,8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "grok-bot":
    case "grok-build":
    case "grok-cloud":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 10.5l5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    default: {
      const label = SHORT_LABELS[harnessId] ?? harnessId.slice(0, 2).toUpperCase();
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect
            x="1.5"
            y="1.5"
            width="13"
            height="13"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <text
            x="8"
            y="10.8"
            textAnchor="middle"
            fill="currentColor"
            fontSize="6.5"
            fontFamily="monospace"
            fontWeight="700"
          >
            {label}
          </text>
        </svg>
      );
    }
  }
}
