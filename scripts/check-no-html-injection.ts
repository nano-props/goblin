#!/usr/bin/env bun
/** Static HTML must never carry credentials or runtime state injected by the server.
 * Browser authentication uses POST /api/login; public presentation hydrates through HTTP.
 * The SPA fallback may serve index.html unchanged. Scan server and shared code,
 * excluding tests and generated output.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const searchRoots = [path.join(repoRoot, 'src', 'server'), path.join(repoRoot, 'src', 'shared')]

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs'])
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|cjs|mjs)$/

interface Rule {
  /** Human-readable label shown in violation messages. */
  label: string
  /** Substring or RegExp to match against file content. */
  match: string | RegExp
}

const RULES: Rule[] = [
  // String-replace on HTML tags. `String.prototype.replace` on a
  // literal `<script` / `<head` / `<html lang` from inside a
  // server handler is the canonical signal of the old bootstrap-
  // injection pattern.
  {
    label: 'HTML tag string-replace from a server handler',
    match: /\.replace\([^)]*['"]<script/,
  },
  {
    label: 'HTML <head> string-replace from a server handler',
    match: /\.replace\(['"]<head>/,
  },
  {
    label: 'HTML <html lang> string-replace from a server handler',
    match: /\.replace\(['"]<html lang=/,
  },
  // Reading the built client HTML to rewrite it. The new
  // architecture serves `dist/web/index.html` untouched via
  // `serveStatic`; a `readFile` of `index.html` from a server
  // route handler is the smoking gun for the old path.
  {
    label: 'server reads dist/web/index.html (SPA fallback is fine, but check it returns it untouched)',
    match: /readFile\([^)]*index\.html/,
  },
  // Legacy function names. If any of these re-appear, the
  // anti-pattern is back. They are intentionally one-word grep
  // patterns — even a comment that says "we used to call
  // buildWebBootstrap" should make the reviewer pause and
  // justify it.
  {
    label: 'legacy injectBootstrapIntoHtml helper',
    match: 'injectBootstrapIntoHtml',
  },
  {
    label: 'legacy buildWebBootstrap helper',
    match: 'buildWebBootstrap',
  },
  {
    label: 'legacy renderClientIndexHtml helper',
    match: 'renderClientIndexHtml',
  },
  {
    label: 'legacy shouldInlineAccessTokenInBootstrap predicate',
    match: 'shouldInlineAccessTokenInBootstrap',
  },
  // Env vars whose only purpose was to gate the HTML inlining.
  // `GOBLIN_HOME_DIR` / `GOBLIN_PLATFORM` are still set in the
  // process environment but the
  // server must not read them — that would mean the bootstrap is
  // being populated server-side.
  {
    label: 'legacy GOBLIN_EMBEDDED_RUNTIME env var (gated HTML inlining)',
    match: 'GOBLIN_EMBEDDED_RUNTIME',
  },
  {
    label: 'legacy GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN env var (gated HTML inlining)',
    match: 'GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN',
  },
  {
    label: 'legacy GOBLIN_HOME_DIR env var (server-side bootstrap inlining)',
    match: 'GOBLIN_HOME_DIR',
  },
  {
    label: 'legacy GOBLIN_PLATFORM env var (server-side bootstrap inlining)',
    match: 'GOBLIN_PLATFORM',
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
