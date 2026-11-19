import type { HarnessId } from "./harness.js";

export interface TokenFootprint {
  readonly descriptionTokens: number;
  readonly frontmatterTokens: number;
  readonly bodyTokens: number;
  readonly fullTokens: number;
}

export interface HarnessTokenSummary {
  readonly harnessId: HarnessId;
  readonly skillCount: number;
  readonly tokens: TokenFootprint;
}

export interface AuthorTokenSummary {
  readonly author: string;
  readonly sourceRepo?: string;
  readonly skillCount: number;
  readonly tokens: TokenFootprint;
}

export interface ProjectTokenSummary {
  readonly projectRoot: string;
  readonly skillCount: number;
  readonly harnesses: readonly HarnessId[];
  readonly tokens: TokenFootprint;
}

export interface GlobalTokenTelemetry {
  readonly totalUniqueSkills: number;
  readonly totalTokens: TokenFootprint;
  readonly projectTokens: TokenFootprint;
  readonly byHarness: readonly HarnessTokenSummary[];
  readonly byAuthor: readonly AuthorTokenSummary[];
  readonly byProject: readonly ProjectTokenSummary[];
}
