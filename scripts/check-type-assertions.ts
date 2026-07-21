#!/usr/bin/env bun
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { glob } from 'tinyglobby'

const repoRoot = path.resolve(import.meta.dirname, '..')

const DOUBLE_ASSERTION_ALLOWLIST = new Map([
  ['src/server/terminal/terminal-render-state.ts', ['serializer as unknown as ITerminalAddon']],
  [
    'src/web/components/terminal/terminal-session-view.ts',
    ['term as unknown as { _core?: { coreService?: { onUserInput?: unknown } } }'],
  ],
])

const sourceFiles = await glob(
  [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.component.test.{ts,tsx}',
    '!src/test-utils/**',
    '!src/**/test-utils/**',
  ],
  { cwd: repoRoot },
)

const violations: string[] = []
for (const file of sourceFiles) {
  const source = await readFile(path.join(repoRoot, file), 'utf8')
  for (const match of source.matchAll(/\/\/\s*@ts-ignore\b/g)) {
    violations.push(`${file}:${sourceLineAt(source, match.index)}: @ts-ignore is forbidden`)
  }
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  })
  visitAst(ast, (node) => {
    if (node.type !== 'TSAsExpression') return
    const lineNumber = node.loc?.start.line ?? 1
    if (node.typeAnnotation?.type === 'TSAnyKeyword') {
      violations.push(`${file}:${lineNumber}: production "as any" is forbidden`)
    }
    if (node.expression?.type !== 'TSAsExpression' || node.expression.typeAnnotation?.type !== 'TSUnknownKeyword') {
      return
    }
    const expression = source.slice(node.start ?? 0, node.end ?? 0)
    const allowed = DOUBLE_ASSERTION_ALLOWLIST.get(file)?.some((snippet) => expression.includes(snippet)) ?? false
    if (!allowed) violations.push(`${file}:${lineNumber}: unreviewed double assertion`)
  })
}

if (violations.length > 0) {
  console.error(
    ['[type-assertions] unsafe type escape hatches found:', ...violations.map((item) => `  - ${item}`)].join('\n'),
  )
  process.exit(1)
}

console.log('[type-assertions] production escape hatches are reviewed')

interface AstNode {
  type?: string
  start?: number | null
  end?: number | null
  loc?: { start: { line: number } } | null
  expression?: AstNode
  typeAnnotation?: AstNode
  [key: string]: unknown
}

function visitAst(value: unknown, visit: (node: AstNode) => void): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) visitAst(item, visit)
    return
  }
  const node = value as AstNode
  if (typeof node.type === 'string') visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc') continue
    visitAst(child, visit)
  }
}

function sourceLineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}
