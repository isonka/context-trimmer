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
  querySynonyms?: Record<string, string[]>;
}

export interface RankedFile extends ScannedFile {
  score: number;
  keywordScore: number;
  recencyScore: number;
  typeScore: number;
  lastModifiedEpochMs: number;
}
interface FileKeywordStats {
  relativePath: string;
  matchesByToken: Map<string, number>;
  contentTokenCount: number;
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
  const tokens = expandQueryTokens(tokenizeQuery(options.query), options.querySynonyms);
  const keywordWeight = options.keywordWeight ?? 0.65;
  const recencyWeight = options.recencyWeight ?? 0.25;
  const typeWeight = options.typeWeight ?? 0.1;
  const typePriority = {
    ...DEFAULT_FILE_TYPE_PRIORITY,
    ...normalizePriorityMap(options.fileTypePriority ?? {})
  };

  const keywordStats = await buildKeywordStats(files, tokens);
  const idf = buildInverseDocumentFrequency(keywordStats, tokens);
  const timestamps = await readModifiedTimestamps(options.rootDir, files);
  const recencyRange = buildRange(Array.from(timestamps.values()));

  const ranked = files.map((file) => {
    const stats = keywordStats.get(file.relativePath);
    const keywordScore = computeKeywordScoreFromStats(stats, tokens, idf);
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
 * Expands base query tokens with light stemming and optional synonym mapping.
 */
export function expandQueryTokens(
  baseTokens: string[],
  querySynonyms: Record<string, string[]> = {}
): string[] {
  const expanded = new Set<string>();
  const mergedSynonyms = {
    ...DEFAULT_SYNONYMS,
    ...querySynonyms
  };

  for (const token of baseTokens) {
    expanded.add(token);
    for (const variant of simpleTokenVariants(token)) {
      expanded.add(variant);
    }
    const synonyms = mergedSynonyms[token] ?? [];
    for (const synonym of synonyms) {
      const normalized = synonym.trim().toLowerCase();
      if (normalized.length > 1) {
        expanded.add(normalized);
      }
    }
  }

  return Array.from(expanded);
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

function computeKeywordScoreFromStats(
  stats: FileKeywordStats | undefined,
  queryTokens: string[],
  inverseDocumentFrequency: Map<string, number>
): number {
  if (!stats || queryTokens.length === 0) {
    return 0;
  }
  let total = 0;
  for (const token of queryTokens) {
    const matches = stats.matchesByToken.get(token) ?? 0;
    const tf = matches / Math.max(1, stats.contentTokenCount);
    total += tf * (inverseDocumentFrequency.get(token) ?? 0);
  }
  return total;
}

function countTokenOccurrences(text: string, token: string): number {
  if (!token) {
    return 0;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "gi");
  const matches = text.match(regex);
  return matches?.length ?? 0;
}

function buildInverseDocumentFrequency(
  statsByPath: Map<string, FileKeywordStats>,
  queryTokens: string[]
): Map<string, number> {
  const totalDocs = Math.max(1, statsByPath.size);
  const result = new Map<string, number>();

  for (const token of queryTokens) {
    let docsContainingToken = 0;
    for (const stats of statsByPath.values()) {
      if ((stats.matchesByToken.get(token) ?? 0) > 0) {
        docsContainingToken += 1;
      }
    }
    const idf = Math.log((1 + totalDocs) / (1 + docsContainingToken)) + 1;
    result.set(token, idf);
  }

  return result;
}
async function buildKeywordStats(
  files: ScannedFile[],
  tokens: string[]
): Promise<Map<string, FileKeywordStats>> {
  const result = new Map<string, FileKeywordStats>();

  await Promise.all(
    files.map(async (file) => {
      const content = file.content ?? (await fs.readFile(file.absolutePath, "utf8"));
      const lowered = content.toLowerCase();
      const contentTokenCount = Math.max(1, lowered.split(/\s+/).length);
      const matchesByToken = new Map<string, number>();
      for (const token of tokens) {
        matchesByToken.set(token, countTokenOccurrences(lowered, token));
      }
      result.set(file.relativePath, {
        relativePath: file.relativePath,
        matchesByToken,
        contentTokenCount
      });
    })
  );

  return result;
}

async function readModifiedTimestamps(rootDir: string, files: ScannedFile[]): Promise<Map<string, number>> {
  const output = new Map<string, number>();
  const gitTimestamps = await readGitTimestampsBatch(rootDir);
  await Promise.all(
    files.map(async (file) => {
      const fullPath = path.resolve(rootDir, file.relativePath);
      const gitTimestamp = gitTimestamps.get(file.relativePath) ?? 0;
      if (gitTimestamp > 0) {
        output.set(file.relativePath, gitTimestamp);
        return;
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

async function readGitTimestampsBatch(rootDir: string): Promise<Map<string, number>> {
  const output = new Map<string, number>();
  try {
    const { stdout } = await execFileAsync("git", ["log", "--name-only", "--format=%ct"], { cwd: rootDir });
    const lines = stdout.split(/\r?\n/);
    let currentTimestamp = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (/^\d+$/.test(line)) {
        currentTimestamp = Number.parseInt(line, 10) * 1000;
        continue;
      }
      if (currentTimestamp <= 0) {
        continue;
      }
      const normalizedPath = line.split(path.sep).join("/");
      if (!output.has(normalizedPath)) {
        output.set(normalizedPath, currentTimestamp);
      }
    }
  } catch {
    return output;
  }
  return output;
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

const DEFAULT_SYNONYMS: Record<string, string[]> = {
  auth: ["authentication", "authorize", "authorization"],
  login: ["signin", "sign-in"],
  cache: ["caching", "memoize", "memoization"],
  db: ["database"],
  bug: ["issue", "defect", "fix"]
};

function simpleTokenVariants(token: string): string[] {
  const variants = new Set<string>();
  if (token.endsWith("ing") && token.length > 4) {
    variants.add(token.slice(0, -3));
  }
  if (token.endsWith("ed") && token.length > 3) {
    variants.add(token.slice(0, -2));
  }
  if (token.endsWith("s") && token.length > 3) {
    variants.add(token.slice(0, -1));
  }
  if (token.endsWith("ation") && token.length > 6) {
    variants.add(token.slice(0, -5));
  }
  return Array.from(variants).filter((value) => value.length > 1);
}
