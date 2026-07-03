#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

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

export function extractImports(source: string, filePath: string): ImportReference[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const values: ImportReference[] = []

  function addImport(importPath: string | null, importedNames: readonly string[] | null): void {
    if (importPath !== null) values.push({ importPath, importedNames })
  }

  function stringLiteralText(node: ts.Node | undefined): string | null {
    return node && ts.isStringLiteralLike(node) ? node.text : null
  }

  function importDeclarationNames(node: ts.ImportDeclaration): readonly string[] | null {
    const clause = node.importClause
    if (!clause) return null
    const names: string[] = []
    if (clause.name) names.push('default')
    if (!clause.namedBindings) return names
    if (ts.isNamespaceImport(clause.namedBindings)) return null
    for (const element of clause.namedBindings.elements) names.push((element.propertyName ?? element.name).text)
    return names
  }

  function exportDeclarationNames(node: ts.ExportDeclaration): readonly string[] | null {
    const clause = node.exportClause
    if (!clause) return null
    if (ts.isNamespaceExport(clause)) return null
    return clause.elements.map((element) => (element.propertyName ?? element.name).text)
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      addImport(stringLiteralText(node.moduleSpecifier), importDeclarationNames(node))
    } else if (ts.isExportDeclaration(node)) {
      addImport(stringLiteralText(node.moduleSpecifier), exportDeclarationNames(node))
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addImport(stringLiteralText(node.arguments[0]), null)
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        addImport(stringLiteralText(node.arguments[0]), null)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return values
}

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
