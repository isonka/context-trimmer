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
  skipped: number;
}

/**
 * Selects ranked files that fit inside the configured token budget.
 */
export function buildBundle(files: RankedFile[], options: BundleOptions): BundleResult {
  const items: BundleItem[] = [];
  let usedTokens = 0;
  let skipped = 0;
  const maxChunkTokens = Math.max(1, options.maxChunkTokens ?? 2000);

  for (const file of files) {
    const chunks = splitFileIntoChunks(file.content, options.tokenizer, maxChunkTokens);
    const firstChunkTokens = chunks[0]?.estimatedTokens ?? 0;
    if (chunks.length === 0 || usedTokens + firstChunkTokens > options.tokenBudget) {
      skipped += 1;
      continue;
    }
    const chunkCount = chunks.length;

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
    }
  }

  return { items, usedTokens, skipped };
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
    `- Files skipped due to budget: ${bundle.skipped}`,
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
  let currentLines: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineWithNewline = `${line}\n`;
    const lineTokens = tokenizer.estimateTokens(lineWithNewline);

    if (lineTokens > maxChunkTokens) {
      if (currentLines.length > 0) {
        chunks.push({
          content: currentLines.join("\n"),
          estimatedTokens: currentTokens
        });
        currentLines = [];
        currentTokens = 0;
      }
      const hardSplit = splitLongLine(lineWithNewline, tokenizer, maxChunkTokens);
      chunks.push(...hardSplit);
      continue;
    }

    if (currentTokens + lineTokens > maxChunkTokens && currentLines.length > 0) {
      chunks.push({
        content: currentLines.join("\n"),
        estimatedTokens: currentTokens
      });
      currentLines = [line];
      currentTokens = tokenizer.estimateTokens(`${line}\n`);
      continue;
    }

    currentLines.push(line);
    currentTokens += lineTokens;
  }

  if (currentLines.length > 0) {
    chunks.push({
      content: currentLines.join("\n"),
      estimatedTokens: currentTokens
    });
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
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
