import { describe, expect, it } from "vitest";
import { createChar4Tokenizer, createTokenizer, estimateChar4Tokens } from "../src/tokenizer.js";

describe("tokenizer", () => {
  it("estimates tokens using char4 strategy", () => {
    expect(estimateChar4Tokens("")).toBe(0);
    expect(estimateChar4Tokens("1234")).toBe(1);
    expect(estimateChar4Tokens("12345")).toBe(2);
  });

  it("creates char4 tokenizer by default", async () => {
    const tokenizer = await createTokenizer();
    expect(tokenizer.estimateTokens("abcd1234")).toBe(2);
  });

  it("creates explicit char4 tokenizer", () => {
    const tokenizer = createChar4Tokenizer();
    expect(tokenizer.estimateTokens("hello world")).toBe(3);
  });
});
