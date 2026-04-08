import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function withTempDir(testFn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "context-trimmer-e2e-"));
  try {
    await testFn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("cli e2e", () => {
  it("generates markdown output file with bundle metrics", async () => {
    await withTempDir(async (fixtureDir) => {
      await fs.mkdir(path.join(fixtureDir, "src"), { recursive: true });
      await fs.writeFile(path.join(fixtureDir, "src", "auth.ts"), "export const auth = true;\n", "utf8");
      await fs.writeFile(path.join(fixtureDir, "src", "other.ts"), "export const value = 1;\n", "utf8");
      const outPath = path.join(fixtureDir, "context.md");

      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "--query",
          "auth middleware",
          "--dir",
          fixtureDir,
          "--budget",
          "100",
          "--out",
          outPath
        ],
        {
          cwd: path.resolve(process.cwd())
        }
      );

      const output = await fs.readFile(outPath, "utf8");
      expect(output).toContain("# Context Bundle");
      expect(output).toContain("Files skipped due to budget");
      expect(output).toContain("Files partially included");
      expect(output).toContain("src/auth.ts");
    });
  });
});
