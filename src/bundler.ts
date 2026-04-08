import { promises as fs } from "node:fs";
import path from "node:path";
import { type RankedFile } from "./ranker.js";
import { type Tokenizer } from "./tokenizer.js";

export interface BundleOptions {
  tokenBudget: number;
  tokenizer: Tokenizer;
  maxChunkTokens?: number;
}

export interface BundleItem {
  path: string;
  content: string;
  estimatedTokens: number;
  score: number;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface BundleResult {
  items: BundleItem[];
  usedTokens: number;
  skippedFully: number;
  partiallyIncluded: number;
}

/**
 * Selects ranked files that fit inside the configured token budget.
 */
export async function buildBundle(files: RankedFile[], options: BundleOptions): Promise<BundleResult> {
  const items: BundleItem[] = [];
  let usedTokens = 0;
  let skippedFully = 0;
  let partiallyIncluded = 0;
  const maxChunkTokens = Math.max(1, options.maxChunkTokens ?? 2000);

  for (const file of files) {
    const content = file.content ?? (await fs.readFile(file.absolutePath, "utf8"));
    const chunks = splitFileIntoChunks(content, options.tokenizer, maxChunkTokens);
    const firstChunkTokens = chunks[0]?.estimatedTokens ?? 0;
    if (chunks.length === 0 || usedTokens + firstChunkTokens > options.tokenBudget) {
      skippedFully += 1;
      continue;
    }
    const chunkCount = chunks.length;

    let includedCount = 0;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      if (!chunk) {
        continue;
      }
      if (usedTokens + chunk.estimatedTokens > options.tokenBudget) {
        break;
      }
      items.push({
        path: file.relativePath,
        content: chunk.content,
        estimatedTokens: chunk.estimatedTokens,
        score: file.score,
        chunkIndex,
        chunkCount
      });
      usedTokens += chunk.estimatedTokens;
      includedCount += 1;
    }
    if (includedCount > 0 && includedCount < chunkCount) {
      partiallyIncluded += 1;
    }
  }

  return { items, usedTokens, skippedFully, partiallyIncluded };
}

/**
 * Formats a bundle into markdown with per-file sections.
 */
export function formatBundleMarkdown(bundle: BundleResult, rootDir: string): string {
  const sections = bundle.items.map((item) => {
    const absolutePath = path.resolve(rootDir, item.path);
    const chunkSuffix =
      item.chunkCount !== undefined && item.chunkCount > 1 && item.chunkIndex !== undefined
        ? ` (chunk ${item.chunkIndex + 1}/${item.chunkCount})`
        : "";
    return [
      `## File: \`${item.path}\`${chunkSuffix}`,
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
    `- Files skipped due to budget: ${bundle.skippedFully}`,
    `- Files partially included: ${bundle.partiallyIncluded}`,
    "",
    ...sections
  ].join("\n");
}

interface ContentChunk {
  content: string;
  estimatedTokens: number;
}

function splitFileIntoChunks(content: string, tokenizer: Tokenizer, maxChunkTokens: number): ContentChunk[] {
  const fullSize = tokenizer.estimateTokens(content);
  if (fullSize <= maxChunkTokens) {
    return [{ content, estimatedTokens: fullSize }];
  }

  const lines = content.split("\n");
  const chunks: ContentChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let currentTokens = 0;
    while (end < lines.length) {
      const nextTokens = tokenizer.estimateTokens(`${lines[end]}\n`);
      if (nextTokens > maxChunkTokens) {
        if (end === start) {
          chunks.push(...splitLongLine(`${lines[end]}\n`, tokenizer, maxChunkTokens));
          end += 1;
        }
        break;
      }
      if (currentTokens + nextTokens > maxChunkTokens) {
        break;
      }
      currentTokens += nextTokens;
      end += 1;
    }

    if (end > start) {
      const preferredEnd = chooseSyntaxAwareBoundary(lines, start, end);
      const finalContent = lines.slice(start, preferredEnd).join("\n");
      chunks.push({
        content: finalContent,
        estimatedTokens: tokenizer.estimateTokens(finalContent)
      });
      start = preferredEnd;
      continue;
    }
    start = Math.max(start + 1, end);
  }

  return chunks.filter((chunk) => chunk.content.trim().length > 0);
}

function splitLongLine(line: string, tokenizer: Tokenizer, maxChunkTokens: number): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  let start = 0;
  const step = 400;

  while (start < line.length) {
    let end = Math.min(line.length, start + step);
    let slice = line.slice(start, end);

    while (tokenizer.estimateTokens(slice) > maxChunkTokens && end > start + 1) {
      end = Math.max(start + 1, Math.floor((start + end) / 2));
      slice = line.slice(start, end);
    }

    chunks.push({
      content: slice,
      estimatedTokens: tokenizer.estimateTokens(slice)
    });
    start = end;
  }

  return chunks;
}

function chooseSyntaxAwareBoundary(lines: string[], start: number, endExclusive: number): number {
  if (endExclusive - start <= 1) {
    return endExclusive;
  }
  const candidateStart = Math.max(start + 1, endExclusive - 15);
  let best = endExclusive;
  let bestScore = -1;

  for (let idx = candidateStart; idx <= endExclusive; idx += 1) {
    const line = (lines[idx - 1] ?? "").trim();
    const nextLine = (lines[idx] ?? "").trim();
    let score = 0;
    if (line === "") {
      score += 4;
    }
    if (line === "}" || line.endsWith("};") || line.endsWith("}")) {
      score += 5;
    }
    if (/^(export |class |function |interface |type )/.test(nextLine)) {
      score += 4;
    }
    if (/^(const |let |var )/.test(nextLine)) {
      score += 2;
    }
    if (score >= bestScore) {
      bestScore = score;
      best = idx;
    }
  }

  return Math.min(Math.max(best, start + 1), endExclusive);
}
