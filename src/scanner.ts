import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

export interface ScannerOptions {
  rootDir: string;
  extensions?: string[];
  includeHidden?: boolean;
  includeContent?: boolean;
}

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  content?: string;
  sizeBytes: number;
}

const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".yml",
  ".yaml"
];

/**
 * Recursively scans a directory and returns file contents filtered by ignore rules.
 */
export async function scanFiles(options: ScannerOptions): Promise<ScannedFile[]> {
  const rootDir = path.resolve(options.rootDir);
  const extensions = normalizeExtensions(options.extensions ?? DEFAULT_EXTENSIONS);
  const includeHidden = options.includeHidden ?? false;
  const includeContent = options.includeContent ?? true;

  const ig = await createIgnoreMatcher(rootDir, includeHidden);
  const files: ScannedFile[] = [];
  await walkDirectory(rootDir, rootDir, ig, extensions, includeContent, files);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Normalizes extensions to lowercase and leading-dot format.
 */
export function normalizeExtensions(extensions: string[]): Set<string> {
  return new Set(
    extensions
      .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
      .map((ext) => ext.toLowerCase())
  );
}

async function walkDirectory(
  rootDir: string,
  currentDir: string,
  ig: Ignore,
  extensions: Set<string>,
  includeContent: boolean,
  files: ScannedFile[]
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));

    if (!relativePath || ig.ignores(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectory(rootDir, absolutePath, ig, extensions, includeContent, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!extensions.has(ext)) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    const content = includeContent ? await fs.readFile(absolutePath, "utf8") : undefined;
    files.push({
      absolutePath,
      relativePath,
      extension: ext,
      content,
      sizeBytes: stat.size
    });
  }
}

async function createIgnoreMatcher(rootDir: string, includeHidden: boolean): Promise<Ignore> {
  const ig = ignore();
  ig.add(["node_modules/", ".git/", "dist/"]);

  if (!includeHidden) {
    ig.add(".*");
  }

  const gitignorePatterns = await readIgnoreFile(path.join(rootDir, ".gitignore"));
  const trimmerIgnorePatterns = await readIgnoreFile(path.join(rootDir, ".trimmerignore"));

  ig.add(gitignorePatterns);
  ig.add(trimmerIgnorePatterns);
  return ig;
}

async function readIgnoreFile(filePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function normalizeRelativePath(rawPath: string): string {
  return rawPath.split(path.sep).join("/");
}
