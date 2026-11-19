import { getEncoding, type Tiktoken } from "js-tiktoken";
import type { TokenCounterPort } from "../application/index.js";
import type { TokenFootprint } from "../domain/index.js";

export class TiktokenCounter implements TokenCounterPort {
  private readonly encoder: Tiktoken;

  constructor(encodingName: "cl100k_base" | "o200k_base" = "cl100k_base") {
    this.encoder = getEncoding(encodingName);
  }

  countText(text: string): number {
    if (!text) return 0;
    return this.encoder.encode(text).length;
  }

  measureSkill(
    description: string,
    frontmatterRaw: string,
    bodyRaw: string,
    fullRaw: string,
  ): TokenFootprint {
    return {
      descriptionTokens: this.countText(description),
      frontmatterTokens: this.countText(frontmatterRaw),
      bodyTokens: this.countText(bodyRaw),
      fullTokens: this.countText(fullRaw),
    };
  }
}
