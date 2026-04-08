import path from "node:path";
import { type RankedFile } from "./ranker.js";
import { type Tokenizer } from "./tokenizer.js";

export interface BundleOptions {
  tokenBudget: number;
  tokenizer: Tokenizer;
}

export interface BundleItem {
  path: string;
  content: string;
  estimatedTokens: number;
  score: number;
}

export interface BundleResult {
  items: BundleItem[];
  usedTokens: number;
  skipped: number;
}

/**
 * Selects ranked files that fit inside the configured token budget.
 */
export function buildBundle(files: RankedFile[], options: BundleOptions): BundleResult {
  const items: BundleItem[] = [];
  let usedTokens = 0;
  let skipped = 0;

  for (const file of files) {
    const estimatedTokens = options.tokenizer.estimateTokens(file.content);
    if (usedTokens + estimatedTokens > options.tokenBudget) {
      skipped += 1;
      continue;
    }

    items.push({
      path: file.relativePath,
      content: file.content,
      estimatedTokens,
      score: file.score
    });
    usedTokens += estimatedTokens;
  }

  return { items, usedTokens, skipped };
}

/**
 * Formats a bundle into markdown with per-file sections.
 */
export function formatBundleMarkdown(bundle: BundleResult, rootDir: string): string {
  const sections = bundle.items.map((item) => {
    const absolutePath = path.resolve(rootDir, item.path);
    return [
      `## File: \`${item.path}\``,
      "",
      `- Absolute path: \`${absolutePath}\``,
      `- Estimated tokens: ${item.estimatedTokens}`,
      `- Score: ${item.score.toFixed(6)}`,
      "",
      "```",
      item.content,
      "```"
    ].join("\n");
  });

  return [
    "# Context Bundle",
    "",
    `- Files included: ${bundle.items.length}`,
    `- Tokens used: ${bundle.usedTokens}`,
    `- Files skipped due to budget: ${bundle.skipped}`,
    "",
    ...sections
  ].join("\n");
}
