import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import { type ScannedFile } from "./scanner.js";

export interface RankerOptions {
  query: string;
  rootDir: string;
  recencyWeight?: number;
  keywordWeight?: number;
  typeWeight?: number;
  fileTypePriority?: Record<string, number>;
}

export interface RankedFile extends ScannedFile {
  score: number;
  keywordScore: number;
  recencyScore: number;
  typeScore: number;
  lastModifiedEpochMs: number;
}

const DEFAULT_FILE_TYPE_PRIORITY: Record<string, number> = {
  ".ts": 1,
  ".tsx": 0.95,
  ".js": 0.85,
  ".jsx": 0.8,
  ".md": 0.7,
  ".json": 0.45,
  ".lock": 0.05
};
const execFileAsync = promisify(execFile);

/**
 * Ranks scanned files by query relevance, recency, and extension priority.
 */
export async function rankFiles(files: ScannedFile[], options: RankerOptions): Promise<RankedFile[]> {
  const tokens = tokenizeQuery(options.query);
  const keywordWeight = options.keywordWeight ?? 0.65;
  const recencyWeight = options.recencyWeight ?? 0.25;
  const typeWeight = options.typeWeight ?? 0.1;
  const typePriority = {
    ...DEFAULT_FILE_TYPE_PRIORITY,
    ...normalizePriorityMap(options.fileTypePriority ?? {})
  };

  const idf = buildInverseDocumentFrequency(files, tokens);
  const timestamps = await readModifiedTimestamps(options.rootDir, files);
  const recencyRange = buildRange(Array.from(timestamps.values()));

  const ranked = files.map((file) => {
    const keywordScore = computeKeywordScore(file.content, tokens, idf);
    const lastModifiedEpochMs = timestamps.get(file.relativePath) ?? 0;
    const recencyScore = normalizeFromRange(lastModifiedEpochMs, recencyRange.min, recencyRange.max);
    const typeScore = typePriority[file.extension] ?? 0;
    const score = keywordScore * keywordWeight + recencyScore * recencyWeight + typeScore * typeWeight;

    return {
      ...file,
      score,
      keywordScore,
      recencyScore,
      typeScore,
      lastModifiedEpochMs
    };
  });

  return ranked.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
}

/**
 * Tokenizes a free-text query into lowercase search terms.
 */
export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

/**
 * Computes a simple TF-IDF style score for a file.
 */
export function computeKeywordScore(
  content: string,
  queryTokens: string[],
  inverseDocumentFrequency: Map<string, number>
): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const lowered = content.toLowerCase();
  const contentTokenCount = Math.max(1, lowered.split(/\s+/).length);
  let total = 0;

  for (const token of queryTokens) {
    const matches = countTokenOccurrences(lowered, token);
    const tf = matches / contentTokenCount;
    const idf = inverseDocumentFrequency.get(token) ?? 0;
    total += tf * idf;
  }

  return total;
}

function countTokenOccurrences(text: string, token: string): number {
  if (!token) {
    return 0;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "g");
  const matches = text.match(regex);
  return matches?.length ?? 0;
}

function buildInverseDocumentFrequency(files: ScannedFile[], queryTokens: string[]): Map<string, number> {
  const totalDocs = Math.max(1, files.length);
  const result = new Map<string, number>();

  for (const token of queryTokens) {
    let docsContainingToken = 0;
    for (const file of files) {
      if (countTokenOccurrences(file.content.toLowerCase(), token) > 0) {
        docsContainingToken += 1;
      }
    }
    const idf = Math.log((1 + totalDocs) / (1 + docsContainingToken)) + 1;
    result.set(token, idf);
  }

  return result;
}

async function readModifiedTimestamps(rootDir: string, files: ScannedFile[]): Promise<Map<string, number>> {
  const output = new Map<string, number>();
  await Promise.all(
    files.map(async (file) => {
      const fullPath = path.resolve(rootDir, file.relativePath);
      try {
        const gitTimestamp = await readGitTimestamp(rootDir, file.relativePath);
        if (gitTimestamp > 0) {
          output.set(file.relativePath, gitTimestamp);
          return;
        }
      } catch {
        // Fall through to filesystem metadata.
      }

      try {
        const stat = await fs.stat(fullPath);
        output.set(file.relativePath, stat.mtimeMs);
      } catch {
        output.set(file.relativePath, 0);
      }
    })
  );
  return output;
}

async function readGitTimestamp(rootDir: string, relativePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%ct", "--", relativePath],
      { cwd: rootDir }
    );
    const seconds = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(seconds) || Number.isNaN(seconds)) {
      return 0;
    }
    return seconds * 1000;
  } catch {
    return 0;
  }
}

function buildRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

function normalizeFromRange(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  return (value - min) / (max - min);
}

function normalizePriorityMap(priority: Record<string, number>): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [ext, value] of Object.entries(priority)) {
    const key = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    normalized[key] = value;
  }
  return normalized;
}
