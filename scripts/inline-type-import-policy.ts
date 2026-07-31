import { parse } from '@babel/parser'

export const INLINE_TYPE_IMPORT_SOURCE_GLOBS = [
  '**/*.{ts,tsx}',
  '!node_modules/**',
  '!dist/**',
  '!release/**',
  '!coverage/**',
] as const

export function findInlineTypeImportViolations(source: string, file: string): string[] {
  const violations: string[] = []
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  })

  visitAst(ast, (node) => {
    if (node.type !== 'TSImportType') return
    violations.push(
      `${file}:${node.loc?.start.line ?? 1}: inline type imports are forbidden; use a top-level import type`,
    )
  })

  return violations
}

interface AstNode {
  type?: string
  loc?: { start: { line: number } } | null
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
