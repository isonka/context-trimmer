import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("cli", () => {
  it("parses required and optional arguments", async () => {
    const args = await parseArgs([
      "--query",
      "add auth middleware",
      "--budget",
      "1200",
      "--dir",
      ".",
      "--extensions",
      "ts",
      "md"
    ]);

    expect(args.query).toBe("add auth middleware");
    expect(args.budget).toBe(1200);
    expect(args.extensions).toEqual(["ts", "md"]);
  });

  it("throws for invalid budget", async () => {
    await expect(parseArgs(["--query", "x", "--budget", "0"])).rejects.toThrow(
      "Invalid --budget value"
    );
  });
});
