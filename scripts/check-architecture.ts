#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const srcRoot = path.join(repoRoot, 'src')

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs'])
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|cjs|mjs)$/

interface Rule {
  fromPrefix: string
  disallow: Array<string | RegExp>
  reason: string
}

const RULES: Rule[] = [
  {
    fromPrefix: '/src/main/',
    disallow: ['#/web/', '#/server/'],
    reason: 'main must only cover Electron-native shell concerns; must not import web or server runtime modules',
  },
  {
    fromPrefix: '/src/web/',
    disallow: ['#/main/'],
    reason: 'web renderer must not directly import main; use preload bridge, native IPC, or server contract instead',
  },
  {
    fromPrefix: '/src/server/',
    disallow: ['electron'],
    reason: 'server runtime must stay Electron-agnostic; avoid coupling backend capabilities to the desktop shell',
  },
  {
    fromPrefix: '/src/shared/',
    disallow: ['electron'],
    reason: 'shared layer must be reusable across web/server/main; must not depend on Electron',
  },
  {
    fromPrefix: '/src/',
    disallow: ['#/shared/terminal.ts'],
    reason:
      'terminal protocol is split by concern; import terminal-types/socket/validators/ownership/ids directly instead of the aggregate entrypoint',
  },
]

function listFiles(dir: string): string[] {
  const entries = readdirSync(dir)
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

function extractImports(source: string): string[] {
  const values = new Set<string>()
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1]?.trim()
      if (value) values.add(value)
    }
  }
  return [...values]
}

function violatesRule(relativeFilePath: string, importPath: string, rule: Rule): boolean {
  if (!relativeFilePath.startsWith(rule.fromPrefix)) return false
  return rule.disallow.some((pattern) =>
    typeof pattern === 'string' ? importPath === pattern || importPath.startsWith(pattern) : pattern.test(importPath),
  )
}

function main(): void {
  const files = listFiles(srcRoot)
  const violations: string[] = []

  for (const filePath of files) {
    const relativeFilePath = normalizePath(filePath)
    const source = readFileSync(filePath, 'utf8')
    const imports = extractImports(source)
    for (const importPath of imports) {
      for (const rule of RULES) {
        if (!violatesRule(relativeFilePath, importPath, rule)) continue
        violations.push(`${relativeFilePath}: disallowed import "${importPath}" — ${rule.reason}`)
      }
    }
  }

  if (violations.length === 0) {
    console.log('[architecture] import boundaries passed')
    return
  }

  console.error('[architecture] import boundary violations found:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

main()
