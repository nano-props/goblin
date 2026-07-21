import { parse } from '@babel/parser'

export function findTypeAssertionViolations(
  source: string,
  file: string,
  doubleAssertionAllowlist: ReadonlyMap<string, readonly string[]>,
): string[] {
  const violations: string[] = []
  for (const match of source.matchAll(/\/\/\s*@ts-ignore\b/g)) {
    violations.push(`${file}:${sourceLineAt(source, match.index)}: @ts-ignore is forbidden`)
  }

  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  })
  visitAst(ast, (node) => {
    if (!isTypeAssertion(node)) return
    const lineNumber = node.loc?.start.line ?? 1
    if (node.typeAnnotation?.type === 'TSAnyKeyword') {
      violations.push(`${file}:${lineNumber}: production any assertion is forbidden`)
    }
    if (!isTypeAssertion(node.expression) || node.expression.typeAnnotation?.type !== 'TSUnknownKeyword') return

    const expression = source.slice(node.start ?? 0, node.end ?? 0).trim()
    const allowed = doubleAssertionAllowlist.get(file)?.includes(expression) ?? false
    if (!allowed) violations.push(`${file}:${lineNumber}: unreviewed double assertion`)
  })
  return violations
}

interface AstNode {
  type?: string
  start?: number | null
  end?: number | null
  loc?: { start: { line: number } } | null
  expression?: AstNode
  typeAnnotation?: AstNode
  [key: string]: unknown
}

function isTypeAssertion(node: AstNode | undefined): node is AstNode {
  return node?.type === 'TSAsExpression' || node?.type === 'TSTypeAssertion'
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
