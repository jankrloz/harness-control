import { load as loadYaml } from "js-yaml";
import type { SkillMetadata } from "../domain/index.js";

export interface ParsedSkillMd {
  readonly metadata: SkillMetadata;
  readonly frontmatterRaw: string;
  readonly bodyRaw: string;
  readonly fullRaw: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMd(rawContent: string, fallbackName: string): ParsedSkillMd {
  const match = rawContent.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      metadata: {
        name: fallbackName,
        description: "",
        rawFrontmatter: {},
      },
      frontmatterRaw: "",
      bodyRaw: rawContent,
      fullRaw: rawContent,
    };
  }

  const frontmatterRaw = match[1] ?? "";
  const bodyRaw = match[2] ?? "";

  let parsed: Record<string, unknown> = {};
  try {
    const loaded = loadYaml(frontmatterRaw);
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      parsed = loaded as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }

  const nestedMeta =
    parsed["metadata"] && typeof parsed["metadata"] === "object"
      ? (parsed["metadata"] as Record<string, unknown>)
      : undefined;

  const name = typeof parsed["name"] === "string" ? parsed["name"] : fallbackName;
  const description = typeof parsed["description"] === "string" ? parsed["description"] : "";
  const author =
    typeof nestedMeta?.["author"] === "string"
      ? nestedMeta["author"]
      : typeof parsed["author"] === "string"
        ? parsed["author"]
        : undefined;
  const version =
    typeof nestedMeta?.["version"] === "string"
      ? nestedMeta["version"]
      : typeof parsed["version"] === "string"
        ? parsed["version"]
        : undefined;
  const license = typeof parsed["license"] === "string" ? parsed["license"] : undefined;
  const deprecated =
    parsed["deprecated"] === true ||
    parsed["status"] === "deprecated" ||
    nestedMeta?.["deprecated"] === true ||
    nestedMeta?.["status"] === "deprecated";
  const deprecationReason =
    typeof parsed["deprecation_reason"] === "string"
      ? parsed["deprecation_reason"]
      : typeof parsed["deprecated_reason"] === "string"
        ? parsed["deprecated_reason"]
        : typeof nestedMeta?.["deprecation_reason"] === "string"
          ? nestedMeta["deprecation_reason"]
          : undefined;
  const replacedBy =
    typeof parsed["replaced_by"] === "string"
      ? parsed["replaced_by"]
      : typeof nestedMeta?.["replaced_by"] === "string"
        ? nestedMeta["replaced_by"]
        : undefined;

  return {
    metadata: {
      name,
      description,
      ...(author ? { author } : {}),
      ...(version ? { version } : {}),
      ...(license ? { license } : {}),
      ...(deprecated ? { deprecated } : {}),
      ...(deprecationReason ? { deprecationReason } : {}),
      ...(replacedBy ? { replacedBy } : {}),
      rawFrontmatter: parsed,
    },
    frontmatterRaw,
    bodyRaw,
    fullRaw: rawContent,
  };
}
