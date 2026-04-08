import { describe, expect, it } from "vitest";
import { buildBundle, formatBundleMarkdown } from "../src/bundler.js";
import { type RankedFile } from "../src/ranker.js";
import { createChar4Tokenizer } from "../src/tokenizer.js";

const rankedFixtures: RankedFile[] = [
  {
    absolutePath: "/tmp/a.ts",
    relativePath: "a.ts",
    extension: ".ts",
    content: "aaaa",
    score: 0.9,
    keywordScore: 0.8,
    recencyScore: 0.5,
    typeScore: 1,
    lastModifiedEpochMs: 1
  },
  {
    absolutePath: "/tmp/b.ts",
    relativePath: "b.ts",
    extension: ".ts",
    content: "bbbbbbbb",
    score: 0.7,
    keywordScore: 0.6,
    recencyScore: 0.4,
    typeScore: 1,
    lastModifiedEpochMs: 1
  }
];

describe("bundler", () => {
  it("selects files within token budget", () => {
    const tokenizer = createChar4Tokenizer();
    const bundle = buildBundle(rankedFixtures, {
      tokenBudget: 2,
      tokenizer
    });
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]?.path).toBe("a.ts");
    expect(bundle.skipped).toBe(1);
  });

  it("formats markdown output", () => {
    const tokenizer = createChar4Tokenizer();
    const bundle = buildBundle(rankedFixtures, {
      tokenBudget: 10,
      tokenizer
    });
    const markdown = formatBundleMarkdown(bundle, "/tmp");
    expect(markdown).toContain("# Context Bundle");
    expect(markdown).toContain("## File: `a.ts`");
  });

  it("chunks large files so partial content can fit", () => {
    const tokenizer = createChar4Tokenizer();
    const large: RankedFile[] = [
      {
        ...rankedFixtures[0],
        relativePath: "large.ts",
        content: "x".repeat(80),
        score: 0.95
      }
    ];

    const bundle = buildBundle(large, {
      tokenBudget: 10,
      maxChunkTokens: 6,
      tokenizer
    });

    expect(bundle.items.length).toBeGreaterThan(0);
    expect(bundle.items[0]?.path).toBe("large.ts");
    expect(bundle.items[0]?.chunkCount).toBeGreaterThan(1);
  });
});
