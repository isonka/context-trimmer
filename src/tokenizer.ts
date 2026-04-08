export type TokenizerMode = "char4" | "tiktoken";

export interface TokenizerOptions {
  mode?: TokenizerMode;
  model?: string;
}

export interface Tokenizer {
  estimateTokens(text: string): number;
  dispose?(): void;
}

/**
 * Creates a tokenizer with the configured estimation strategy.
 */
export async function createTokenizer(options: TokenizerOptions = {}): Promise<Tokenizer> {
  const mode = options.mode ?? "char4";
  if (mode === "tiktoken") {
    return createTiktokenTokenizer(options.model);
  }

  return createChar4Tokenizer();
}

/**
 * Estimates token usage by dividing character count by 4.
 */
export function estimateChar4Tokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/**
 * Creates a lightweight char/4 tokenizer.
 */
export function createChar4Tokenizer(): Tokenizer {
  return {
    estimateTokens(text: string): number {
      return estimateChar4Tokens(text);
    }
  };
}

async function createTiktokenTokenizer(model?: string): Promise<Tokenizer> {
  try {
    const pkg = await import("tiktoken");
    const encoding = pkg.encoding_for_model(model ?? "gpt-4o-mini");
    return {
      estimateTokens(text: string): number {
        const encoded = encoding.encode(text);
        return encoded.length;
      },
      dispose(): void {
        if ("free" in encoding && typeof encoding.free === "function") {
          encoding.free();
        }
      }
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `tiktoken tokenizer requested but unavailable. Install peer dependency 'tiktoken'. Details: ${detail}`
    );
  }
}
