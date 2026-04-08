import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandQueryTokens, rankFiles, tokenizeQuery } from "../src/ranker.js";
import { type ScannedFile } from "../src/scanner.js";

async function withTempDir(testFn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "context-trimmer-ranker-"));
  try {
    await testFn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("ranker", () => {
  it("tokenizes query into lowercase terms", () => {
    expect(tokenizeQuery("Add AUTH middleware!")).toEqual(["add", "auth", "middleware"]);
  });

  it("ranks files higher when keyword frequency is stronger", async () => {
    await withTempDir(async (dir) => {
      const files: ScannedFile[] = [
        {
          absolutePath: path.join(dir, "a.ts"),
          relativePath: "a.ts",
          extension: ".ts",
          content: "auth middleware auth middleware auth"
        },
        {
          absolutePath: path.join(dir, "b.json"),
          relativePath: "b.json",
          extension: ".json",
          content: "{\"note\":\"nothing here\"}"
        }
      ];
      await fs.writeFile(path.join(dir, "a.ts"), files[0].content, "utf8");
      await fs.writeFile(path.join(dir, "b.json"), files[1].content, "utf8");

      const ranked = await rankFiles(files, {
        query: "auth middleware",
        rootDir: dir
      });

      expect(ranked[0].relativePath).toBe("a.ts");
      expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    });
  });

  it("expands query tokens with synonyms and variants", () => {
    const expanded = expandQueryTokens(["auth"]);
    expect(expanded).toContain("authentication");
    expect(expanded).toContain("authorization");
  });
});
