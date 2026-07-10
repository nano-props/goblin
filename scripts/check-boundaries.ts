#!/usr/bin/env bun
// Architecture boundary guard. It extracts real module edges with Babel's AST
// parser, then applies project-specific layering rules and a few legacy source
// pattern bans that are intentionally text-based.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse, type ParserPlugin } from '@babel/parser'

const repoRoot = path.resolve(import.meta.dirname, '..')
const srcRoot = path.join(repoRoot, 'src')

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs'])
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|cjs|mjs)$/

export interface Rule {
  fromPrefix: string
  disallow: Array<string | RegExp>
  reason: string
  allowedImportsByFile?: Record<string, readonly string[]>
}

interface SourcePattern {
  label: string
  pattern: RegExp
}

export interface SourcePatternRule {
  fromPrefix: string
  disallow: SourcePattern[]
  reason: string
}

export interface ImportReference {
  importPath: string
  importedNames: readonly string[] | null
}

const RULES: Rule[] = [
  {
    fromPrefix: '/src/main/',
    disallow: ['#/web/', '#/server/'],
    reason: 'main must only cover native-host concerns; must not import web or server runtime modules',
  },
  {
    fromPrefix: '/src/web/',
    disallow: ['#/main/'],
    reason: 'web client must not directly import main; use preload bridge, native IPC, or server contract instead',
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
  {
    fromPrefix: '/src/web/',
    disallow: ['#/web/settings-client.ts'],
    allowedImportsByFile: {
      '/src/web/hooks/useAuthenticatedAppBootstrap.ts': ['getExternalAppsSnapshot', 'getSettingsSnapshot'],
      '/src/web/settings-actions.ts': [
        'addRecentRepo',
        'clearRecentRepos',
        'refreshExternalAppsSnapshot',
        'refreshGitHubCliState',
        'saveSession',
        'setGlobalShortcut',
        'setGlobalShortcutDisabled',
        'setI18nPref',
        'setLanEnabled',
        'setRecentWorkspaceExternalApp',
        'setSettingsFetchInterval',
        'setShortcutsDisabled',
        'setTerminalNotificationsEnabled',
        'setThemeColorTheme',
        'setThemePref',
      ],
      '/src/web/settings-queries.ts': [
        'getExternalAppsSnapshot',
        'getGitHubCliState',
        'getLanInfo',
        'getSettingsSnapshot',
      ],
      '/src/web/stores/i18n.ts': ['getI18nSnapshot'],
      '/src/web/stores/session-restore.ts': ['getSettingsSnapshot'],
      '/src/web/stores/theme.ts': ['getThemeState', 'resolveThemeStateFromSettings'],
    },
    reason:
      'settings-client is the transport boundary; settings writes must flow through settings-actions so server results update React Query projections',
  },
]

const SOURCE_PATTERN_RULES: SourcePatternRule[] = [
  {
    fromPrefix: '/src/web/',
    disallow: [
      { label: 'legacy repo IPC read route', pattern: /['"`]repo\.(?:snapshot|status|composite)['"`]/ },
      { label: 'legacy repo HTTP read route', pattern: /['"`]\/api\/repo\/(?:snapshot|status|composite)\b/ },
      { label: 'legacy repo read helper', pattern: /\bgetRepo(?:Snapshot|Status|Composite)\b/ },
      {
        label: 'legacy repo procedure schema key',
        pattern: /\b(?:REPO_QUERY_SCHEMAS|REPO_PROCEDURE_SCHEMAS)\.(?:snapshot|status|composite)\b/,
      },
    ],
    reason:
      'web repo reads must flow through the runtime projection and React Query read-model surfaces, not legacy direct snapshot/status/composite reads',
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

// ---------------------------------------------------------------------------
// Source scanner
// ---------------------------------------------------------------------------

type BabelNode = { type: string; [key: string]: unknown }

const NON_CHILD_NODE_KEYS = new Set([
  'comments',
  'errors',
  'extra',
  'innerComments',
  'leadingComments',
  'loc',
  'start',
  'end',
  'trailingComments',
  'tokens',
])

function parserPlugins(filePath: string): ParserPlugin[] {
  return [
    ['typescript', { dts: filePath.endsWith('.d.ts') }],
    'jsx',
    'importMeta',
    'dynamicImport',
    'exportNamespaceFrom',
    'topLevelAwait',
    'importAttributes',
    'importAssertions',
    'decorators-legacy',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'classStaticBlock',
    'explicitResourceManagement',
  ]
}

function isNode(value: unknown): value is BabelNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

function asNodeArray(value: unknown): BabelNode[] {
  return Array.isArray(value) ? value.filter(isNode) : []
}

function stringLiteralValue(node: unknown): string | null {
  if (!isNode(node)) return null
  if (node.type !== 'StringLiteral' && node.type !== 'DirectiveLiteral') return null
  return typeof node.value === 'string' ? node.value : null
}

function identifierName(node: unknown): string | null {
  if (!isNode(node)) return null
  if (node.type === 'Identifier') return typeof node.name === 'string' ? node.name : null
  if (node.type === 'StringLiteral') return typeof node.value === 'string' ? node.value : null
  return null
}

function traverse(node: BabelNode, visit: (node: BabelNode) => void): void {
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (NON_CHILD_NODE_KEYS.has(key)) continue
    if (isNode(value)) {
      traverse(value, visit)
      continue
    }
    if (!Array.isArray(value)) continue
    for (const child of value) {
      if (isNode(child)) traverse(child, visit)
    }
  }
}

function parseSource(source: string, filePath: string): BabelNode {
  try {
    const ast = parse(source, {
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      attachComment: false,
      createImportExpressions: true,
      errorRecovery: true,
      plugins: parserPlugins(filePath),
      sourceFilename: filePath,
      sourceType: 'unambiguous',
    })
    if (ast.errors?.length) {
      const firstError = ast.errors[0]!
      throw new Error(firstError.message)
    }
    return ast as unknown as BabelNode
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`failed to parse ${filePath}: ${message}`)
  }
}

function importDeclarationNames(node: BabelNode): readonly string[] | null {
  const specifiers = asNodeArray(node.specifiers)
  if (specifiers.length === 0) return null

  const names: string[] = []
  for (const specifier of specifiers) {
    if (specifier.type === 'ImportNamespaceSpecifier') return null
    if (specifier.type === 'ImportDefaultSpecifier') {
      names.push('default')
      continue
    }
    if (specifier.type !== 'ImportSpecifier') return null
    const name = identifierName(specifier.imported)
    if (name === null) return null
    names.push(name)
  }
  return names
}

function exportDeclarationNames(node: BabelNode): readonly string[] | null {
  const specifiers = asNodeArray(node.specifiers)
  if (specifiers.length === 0) return null

  const names: string[] = []
  for (const specifier of specifiers) {
    if (specifier.type === 'ExportNamespaceSpecifier') return null
    if (specifier.type === 'ExportDefaultSpecifier') {
      names.push('default')
      continue
    }
    if (specifier.type !== 'ExportSpecifier') return null
    const name = identifierName(specifier.local)
    if (name === null) return null
    names.push(name)
  }
  return names
}

function addImport(
  results: ImportReference[],
  importPath: string | null,
  importedNames: readonly string[] | null,
): void {
  if (importPath === null) return
  results.push({ importPath, importedNames })
}

export function extractImports(source: string, filePath: string): ImportReference[] {
  const ast = parseSource(source, filePath)
  const results: ImportReference[] = []

  traverse(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      addImport(results, stringLiteralValue(node.source), importDeclarationNames(node))
      return
    }
    if (node.type === 'ExportNamedDeclaration') {
      addImport(results, stringLiteralValue(node.source), exportDeclarationNames(node))
      return
    }
    if (node.type === 'ExportAllDeclaration') {
      addImport(results, stringLiteralValue(node.source), null)
      return
    }
    if (node.type === 'ImportExpression') {
      addImport(results, stringLiteralValue(node.source), null)
      return
    }
    if (node.type !== 'CallExpression') return

    const callee = node.callee
    if (!isNode(callee) || callee.type !== 'Identifier' || callee.name !== 'require') return
    addImport(results, stringLiteralValue(asNodeArray(node.arguments)[0]), null)
  })

  return results
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

function canonicalImportPath(importPath: string, relativeFilePath: string): string {
  if (importPath.startsWith('#/')) return `/src/${importPath.slice(2)}`
  if (importPath.startsWith('.')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(relativeFilePath), importPath))
  }
  return importPath
}

function importMatchesRule(importPath: string, relativeFilePath: string, rule: Rule): boolean {
  const candidates = new Set([importPath, canonicalImportPath(importPath, relativeFilePath)])
  return rule.disallow.some((pattern) => {
    if (typeof pattern !== 'string') return [...candidates].some((candidate) => pattern.test(candidate))
    const canonicalPattern = canonicalImportPath(pattern, relativeFilePath)
    return [...candidates].some(
      (candidate) =>
        candidate === pattern ||
        candidate.startsWith(pattern) ||
        candidate === canonicalPattern ||
        candidate.startsWith(canonicalPattern),
    )
  })
}

export function violatesRule(relativeFilePath: string, importRef: ImportReference, rule: Rule): boolean {
  if (!relativeFilePath.startsWith(rule.fromPrefix)) return false
  if (!importMatchesRule(importRef.importPath, relativeFilePath, rule)) return false
  const allowedImports = rule.allowedImportsByFile?.[relativeFilePath]
  if (!allowedImports) return true
  if (importRef.importedNames === null) return true
  const allowed = new Set(allowedImports)
  return importRef.importedNames.some((name) => !allowed.has(name))
}

export function checkArchitectureSources(
  sources: Array<{ relativeFilePath: string; source: string }>,
  rules: readonly Rule[] = RULES,
  sourcePatternRules: readonly SourcePatternRule[] = SOURCE_PATTERN_RULES,
): string[] {
  const violations: string[] = []
  for (const { relativeFilePath, source } of sources) {
    const imports = extractImports(source, relativeFilePath)
    for (const importRef of imports) {
      for (const rule of rules) {
        if (!violatesRule(relativeFilePath, importRef, rule)) continue
        violations.push(`${relativeFilePath}: disallowed import "${importRef.importPath}" — ${rule.reason}`)
      }
    }
    for (const rule of sourcePatternRules) {
      if (!relativeFilePath.startsWith(rule.fromPrefix)) continue
      for (const pattern of rule.disallow) {
        if (!pattern.pattern.test(source)) continue
        violations.push(`${relativeFilePath}: disallowed source pattern "${pattern.label}" — ${rule.reason}`)
      }
    }
  }
  return violations
}

export function main(): void {
  const files = listFiles(srcRoot)
  const violations = checkArchitectureSources(
    files.map((filePath) => ({
      relativeFilePath: normalizePath(filePath),
      source: readFileSync(filePath, 'utf8'),
    })),
  )

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

if (import.meta.main) main()
