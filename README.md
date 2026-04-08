# context-trimmer

[![npm](https://img.shields.io/npm/v/context-trimmer)](https://www.npmjs.com/package/context-trimmer)
[![node](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://www.typescriptlang.org/)

A TypeScript CLI + library for building LLM-ready context bundles from a local repository.

## Why this exists

Large codebases easily exceed model context limits. Manual copy/paste is noisy and often misses the most relevant files. `context-trimmer` scans your project, ranks files against a task query, estimates token usage, and emits the best-fit bundle under a strict budget — so the model sees what matters, not just what's largest.

Built for engineers working with AI pair programmers who want deterministic, reproducible context — not guesswork.

## Quick start

```bash
npx context-trimmer --query "add auth middleware" --budget 32000 --out context.md
```

Stream to stdout:

```bash
npx context-trimmer --query "fix cache invalidation bug" --budget 16000
```

## How ranking works

Each file receives a composite relevance score based on three signals:

- **Query match** — TF-IDF style frequency of query terms within the file content, normalised by file length
- **Recency** — files modified more recently (via `git log`) score higher, on the assumption that active files are more relevant
- **File type priority** — configurable weighting by extension (e.g. `.ts` > `.json` > `.lock`)

Files are then selected greedily by score until the token budget is exhausted.

### Performance notes

- The CLI uses metadata-first scanning (`includeContent: false`) to reduce peak memory during directory traversal.
- Content is loaded lazily during ranking/bundling only when needed.
- Recency scoring uses batched git history parsing with filesystem timestamp fallback.

## Config options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--query` | `string` | required | Task description used for relevance ranking |
| `--budget` | `number` | `32000` | Max estimated tokens for the output bundle |
| `--dir` | `string` | current working dir | Root directory to scan |
| `--out` | `string` | none (stdout) | Output markdown file path |
| `--extensions` | `string[]` | `ts tsx js jsx json md` | Extension whitelist |
| `--tokenizer` | `"char4" \| "tiktoken"` | `char4` | Token estimator strategy |
| `--model` | `string` | `gpt-4o-mini` | Tiktoken model encoding (only used with `tiktoken`) |

**Ignore behaviour:**
- Respects `.gitignore`
- Respects `.trimmerignore` (same syntax as `.gitignore`)
- Always ignores `node_modules`, `.git`, and `dist`

## Example output

```markdown
# Context Bundle

- Files included: 3
- Tokens used: 18,542
- Files skipped due to budget: 9
- Files partially included: 1

---

## src/auth/middleware.ts

- Estimated tokens: 1,460
- Score: 0.812

\`\`\`ts
import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./token";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
\`\`\`

---

## src/auth/token.ts

- Estimated tokens: 890
- Score: 0.761

\`\`\`ts
// ... file content continues
\`\`\`
```

## Library usage

```ts
import {
  scanFiles,
  rankFiles,
  createTokenizer,
  buildBundle,
  formatBundleMarkdown,
} from "context-trimmer";

const files = await scanFiles({ rootDir: process.cwd() });
// For large repos, prefer metadata-first scanning:
// const files = await scanFiles({ rootDir: process.cwd(), includeContent: false });

const ranked = await rankFiles(files, {
  query: "add auth middleware",
  rootDir: process.cwd(),
});

const tokenizer = await createTokenizer({ mode: "char4" });

const bundle = await buildBundle(ranked, {
  tokenBudget: 32000,
  tokenizer,
});

console.log(formatBundleMarkdown(bundle, process.cwd()));
```

## Chunking behavior

When a file is too large for remaining budget, `buildBundle()` can include it in chunks (`maxChunkTokens`), using syntax-aware boundary heuristics:

- prefers breaks at blank lines
- prefers breaks near closing braces (`}` / `};`)
- prefers boundaries before declarations (`export`, `class`, `function`, `interface`, `type`, etc.)

This improves readability vs pure fixed-size splitting while still honoring token limits.

## Development

```bash
npm install
npm test        # Vitest
npm run build   # tsc
```

## Contributing

Open an issue before starting large changes — alignment on scope saves time for everyone.

Pull requests should:
- Be scoped to a single concern
- Include Vitest tests for any changed behaviour
- Pass `npm test && npm run build` before submission
- Follow the existing ESLint config (`npm run lint`)

Code style is enforced via ESLint + Prettier. The project targets Node.js 18+ and TypeScript strict mode throughout — no `any`, no suppressions without a comment explaining why.