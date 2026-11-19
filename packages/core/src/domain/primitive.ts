/**
 * Supported extension primitives across AI coding harnesses.
 * Phase 1 implements 'skill'; the model is designed for future primitives.
 */
export type PrimitiveKind = "skill" | "mcp" | "hook" | "command" | "lsp" | "prompt";

export const ALL_PRIMITIVE_KINDS: readonly PrimitiveKind[] = [
  "skill",
  "mcp",
  "hook",
  "command",
  "lsp",
  "prompt",
] as const;

export type Scope = "global" | "project";
