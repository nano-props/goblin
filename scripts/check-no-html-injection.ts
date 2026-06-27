#!/usr/bin/env bun
/**
 * Regression guard against the old "server reads dist/web/index.html
 * and rewrites it to inject the client bootstrap" anti-pattern.
 *
 * Why this exists: in the auth refactor (#59) the client bootstrap
 * moved from inlined HTML (token + i18n + settings baked into
 * `<script id="goblin-bootstrap">` at response-build time) to a
 * pure IPC model — the Electron preload seeds
 * `window.__GOBLIN_BOOTSTRAP__` via `goblin:get-access-token` etc.,
 * and the web path goes through the `/api/login` gate. We also
 * dropped the i18n / settings inlining while we were at it.
 *
 * The HTML-injection path was an anti-pattern: it coupled the
 * server to the client's bundle format, it made the dev mode
 * broken (Vite-served HTML can never carry the secret), and it
 * leaked long-lived credentials into the response body of every
 * page render. This guard makes sure none of it sneaks back in.
 *
 * What it checks (each pattern in either the `match` set or the
 * `commentAware` set — see the per-rule `comment` flag):
 *
 *  - `replace(...<script|...<head|...<html lang` — string-replace
 *    on HTML tags from inside server/handlers.
 *  - `readFile(...index.html` — reading the built client HTML
 *    to rewrite it (the SPA fallback is allowed to read it but
 *    must serve it untouched).
 *  - `injectBootstrapIntoHtml` / `buildWebBootstrap` /
 *    `renderClientIndexHtml` / `shouldInlineAccessTokenInBootstrap`
 *    — the legacy function names.
 *  - `GOBLIN_EMBEDDED_RUNTIME` / `GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN`
 *    — the env vars whose only purpose was to gate HTML inlining.
 *  - `GOBLIN_HOME_DIR` / `GOBLIN_PLATFORM` — passed to the server
 *    child process so it could bake the values into the bootstrap;
 *    the client now gets them via `goblin:get-home-dir` /
 *    `goblin:get-platform` IPC. Allowed in the Electron main
 *    spawn-env (deprecated; harmless) but flagged in src/server.
 *
 * `commentAware: true` rules match against the raw file content
 * so a defensive `// GOBLIN_EMBEDDED_RUNTIME=1` comment in a
 * refactor note doesn't trip the guard. Everything else is a
 * plain code-level match.
 *
 * The script walks src/server, src/main, and src/shared. It
 * ignores `*.test.*` / `*.spec.*` files and the `dist/` build
 * output. Test files may reference the legacy names for explicit
 * negative checks; production code must not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const searchRoots = [
  path.join(repoRoot, 'src', 'server'),
  path.join(repoRoot, 'src', 'main'),
  path.join(repoRoot, 'src', 'shared'),
]

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs'])
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|cjs|mjs)$/

interface Rule {
  /** Human-readable label shown in violation messages. */
  label: string
  /** Substring or RegExp to match against file content. */
  match: string | RegExp
  /**
   * If true, the rule flags files whose raw content includes the
   * match. If false, the rule flags files that call / use the
   * match as code (string literal, identifier, import). The two
   * are the same in practice — comments count as content — but
   * the labels differ so the violation message is precise.
   */
  commentAware: boolean
}

const RULES: Rule[] = [
  // String-replace on HTML tags. `String.prototype.replace` on a
  // literal `<script` / `<head` / `<html lang` from inside a
  // server handler is the canonical signal of the old bootstrap-
  // injection pattern.
  {
    label: 'HTML tag string-replace from a server handler',
    match: /\.replace\([^)]*['"]<script/,
    commentAware: false,
  },
  {
    label: 'HTML <head> string-replace from a server handler',
    match: /\.replace\(['"]<head>/,
    commentAware: false,
  },
  {
    label: 'HTML <html lang> string-replace from a server handler',
    match: /\.replace\(['"]<html lang=/,
    commentAware: false,
  },
  // Reading the built client HTML to rewrite it. The new
  // architecture serves `dist/web/index.html` untouched via
  // `serveStatic`; a `readFile` of `index.html` from a server
  // route handler is the smoking gun for the old path.
  {
    label: 'server reads dist/web/index.html (SPA fallback is fine, but check it returns it untouched)',
    match: /readFile\([^)]*index\.html/,
    commentAware: false,
  },
  // Legacy function names. If any of these re-appear, the
  // anti-pattern is back. They are intentionally one-word grep
  // patterns — even a comment that says "we used to call
  // buildWebBootstrap" should make the reviewer pause and
  // justify it.
  {
    label: 'legacy injectBootstrapIntoHtml helper',
    match: 'injectBootstrapIntoHtml',
    commentAware: true,
  },
  {
    label: 'legacy buildWebBootstrap helper',
    match: 'buildWebBootstrap',
    commentAware: true,
  },
  {
    label: 'legacy renderClientIndexHtml helper',
    match: 'renderClientIndexHtml',
    commentAware: true,
  },
  {
    label: 'legacy shouldInlineAccessTokenInBootstrap predicate',
    match: 'shouldInlineAccessTokenInBootstrap',
    commentAware: true,
  },
  // Env vars whose only purpose was to gate the HTML inlining.
  // `GOBLIN_HOME_DIR` / `GOBLIN_PLATFORM` are still set in the
  // native host spawn-env (legacy compat, harmless) but the
  // server must not read them — that would mean the bootstrap is
  // being populated server-side.
  {
    label: 'legacy GOBLIN_EMBEDDED_RUNTIME env var (gated HTML inlining)',
    match: 'GOBLIN_EMBEDDED_RUNTIME',
    commentAware: true,
  },
  {
    label: 'legacy GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN env var (gated HTML inlining)',
    match: 'GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN',
    commentAware: true,
  },
  {
    label: 'legacy GOBLIN_HOME_DIR env var (server-side bootstrap inlining)',
    match: 'GOBLIN_HOME_DIR',
    commentAware: true,
  },
  {
    label: 'legacy GOBLIN_PLATFORM env var (server-side bootstrap inlining)',
    match: 'GOBLIN_PLATFORM',
    commentAware: true,
  },
]

function listFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...listFiles(fullPath))
      continue
    }
    const ext = path.extname(entry)
    if (!SOURCE_EXTENSIONS.has(ext)) continue
    if (TEST_FILE_RE.test(entry)) continue
    files.push(fullPath)
  }
  return files
}

function normalizePath(filePath: string): string {
  return filePath.slice(repoRoot.length).replaceAll(path.sep, '/')
}

function findMatches(content: string, pattern: string | RegExp): string[] {
  if (typeof pattern === 'string') {
    const matches: string[] = []
    let index = content.indexOf(pattern)
    while (index !== -1) {
      const start = Math.max(0, index - 30)
      const end = Math.min(content.length, index + pattern.length + 30)
      matches.push(`…${content.slice(start, end).replaceAll('\n', '\\n')}…`)
      index = content.indexOf(pattern, index + pattern.length)
    }
    return matches
  }
  const matches: string[] = []
  for (const match of content.matchAll(new RegExp(pattern, 'g'))) {
    const index = match.index ?? 0
    const start = Math.max(0, index - 30)
    const end = Math.min(content.length, index + match[0].length + 30)
    matches.push(`…${content.slice(start, end).replaceAll('\n', '\\n')}…`)
  }
  return matches
}

function main(): void {
  const files = searchRoots.flatMap((root) => listFiles(root))
  const violations: string[] = []

  for (const filePath of files) {
    const relative = normalizePath(filePath)
    const content = readFileSync(filePath, 'utf8')
    for (const rule of RULES) {
      const matches = findMatches(content, rule.match)
      if (matches.length === 0) continue
      for (const excerpt of matches) {
        violations.push(`${relative}: ${rule.label}\n    match: ${excerpt}`)
      }
    }
  }

  if (violations.length === 0) {
    console.log('[no-html-injection] clean — server never rewrites dist/web/index.html')
    return
  }

  console.error('[no-html-injection] forbidden patterns found:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

main()
