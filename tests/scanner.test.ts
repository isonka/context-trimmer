import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeExtensions, scanFiles } from "../src/scanner.js";

async function withTempDir(testFn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "context-trimmer-"));
  try {
    await testFn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("scanner", () => {
  it("normalizes extension values", () => {
    const normalized = normalizeExtensions(["ts", ".JS"]);
    expect(normalized.has(".ts")).toBe(true);
    expect(normalized.has(".js")).toBe(true);
  });

  it("respects extension whitelist and ignore files", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(path.join(dir, "src", "keep.ts"), "export const a = 1;", "utf8");
      await fs.writeFile(path.join(dir, "src", "drop.json"), "{\"x\":1}", "utf8");
      await fs.writeFile(path.join(dir, "src", "ignored.ts"), "export const b = 2;", "utf8");
      await fs.writeFile(path.join(dir, ".trimmerignore"), "src/ignored.ts", "utf8");

      const files = await scanFiles({
        rootDir: dir,
        extensions: [".ts"]
      });
      const paths = files.map((f) => f.relativePath);
      expect(paths).toContain("src/keep.ts");
      expect(paths).not.toContain("src/drop.json");
      expect(paths).not.toContain("src/ignored.ts");
    });
  });
});
