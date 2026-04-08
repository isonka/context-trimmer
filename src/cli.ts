#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { buildBundle, formatBundleMarkdown } from "./bundler.js";
import { rankFiles } from "./ranker.js";
import { scanFiles } from "./scanner.js";
import { createTokenizer } from "./tokenizer.js";

interface CliArgs {
  query: string;
  budget: number;
  dir: string;
  out?: string;
  extensions: string[];
  tokenizer: "char4" | "tiktoken";
  model?: string;
}

async function run(): Promise<void> {
  try {
    const argv = await parseArgs();
    const rootDir = path.resolve(argv.dir);

    const scanned = await scanFiles({
      rootDir,
      extensions: argv.extensions
    });

    const ranked = await rankFiles(scanned, {
      query: argv.query,
      rootDir
    });

    const tokenizer = await createTokenizer({
      mode: argv.tokenizer,
      model: argv.model
    });

    const bundle = buildBundle(ranked, {
      tokenBudget: argv.budget,
      tokenizer
    });
    const markdown = formatBundleMarkdown(bundle, rootDir);

    if (argv.out) {
      await fs.writeFile(path.resolve(argv.out), markdown, "utf8");
      process.stderr.write(
        `context-trimmer: wrote ${bundle.items.length} files (${bundle.usedTokens} tokens) to ${argv.out}\n`
      );
      return;
    }

    process.stdout.write(`${markdown}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`context-trimmer: ${message}\n`);
    process.exitCode = 1;
  }
}

/**
 * Parses and validates command-line arguments.
 */
export async function parseArgs(argvInput: string[] = hideBin(process.argv)): Promise<CliArgs> {
  const parsed = await yargs(argvInput)
    .scriptName("context-trimmer")
    .usage("$0 --query \"add auth middleware\" --budget 32000 --out context.md")
    .option("query", {
      type: "string",
      demandOption: true,
      describe: "Task or question used for file relevance ranking"
    })
    .option("budget", {
      type: "number",
      default: 32000,
      describe: "Maximum estimated token budget for selected files"
    })
    .option("dir", {
      type: "string",
      default: process.cwd(),
      describe: "Root directory to scan"
    })
    .option("out", {
      type: "string",
      describe: "Optional output markdown file path"
    })
    .option("extensions", {
      type: "array",
      string: true,
      default: ["ts", "tsx", "js", "jsx", "json", "md"],
      describe: "List of file extensions to include"
    })
    .option("tokenizer", {
      choices: ["char4", "tiktoken"] as const,
      default: "char4",
      describe: "Token estimation strategy"
    })
    .option("model", {
      type: "string",
      describe: "Model name for tiktoken encoding lookup"
    })
    .help()
    .strict()
    .parseAsync();

  if (!Number.isFinite(parsed.budget) || parsed.budget <= 0) {
    throw new Error("Invalid --budget value. Use a positive number.");
  }

  const tokenizer = parsed.tokenizer === "tiktoken" ? "tiktoken" : "char4";

  return {
    query: parsed.query,
    budget: Math.floor(parsed.budget),
    dir: parsed.dir,
    out: parsed.out,
    extensions: parsed.extensions.map((value) => String(value)),
    tokenizer,
    model: parsed.model
  };
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void run();
}
