import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import traverse, { type Binding, type NodePath } from '@babel/traverse'
import type { CallExpression } from '@babel/types'
import { describe, expect, test } from 'vitest'
import { glob } from 'tinyglobby'

const POLICY_FILE = 'src/test-utils/test-harness-policy.test.ts'
const CANONICAL_WEBSOCKET_MOCK_FILE = 'src/web/test-utils/websocket-mock.ts'
const CANONICAL_XTERM_MOCK_FILE = 'src/web/test-utils/terminal-session.ts'
const CANONICAL_TIMERS_FILE = 'src/test-utils/timers.ts'
const CANONICAL_STORAGE_FILE = 'src/test-utils/storage.ts'
const CANONICAL_FETCH_MOCK_FILES = new Set(['src/test-utils/fetch-mock.ts', 'src/web/test-utils/bridge.ts'])
const MAX_TEST_SURFACE_LINES = 1_500
const TEST_FILE_GLOBS = ['src/**/*.test.ts', 'src/**/*.test.tsx']
const TEST_UTILITY_GLOBS = [
  'src/test-utils/**/*.ts',
  'src/test-utils/**/*.tsx',
  'src/server/test-utils/**/*.ts',
  'src/server/test-utils/**/*.tsx',
  'src/web/test-utils/**/*.ts',
  'src/web/test-utils/**/*.tsx',
  'src/**/*.test-utils.ts',
  'src/**/*.test-utils.tsx',
  'src/**/*-test-utils.ts',
  'src/**/*-test-utils.tsx',
]

const repositoryPolicyLabels = [
  'hand-rolled React root',
  'act imported directly from React',
  'manual React act-environment mutation',
  'inline WebSocket mock',
  'test-local fetch replacement',
  'test-local Storage replacement',
] as const

type PolicyLabel = (typeof repositoryPolicyLabels)[number] | 'direct fake-timer configuration'

const analysisByFile = new Map<string, Promise<ReadonlySet<PolicyLabel>>>()

describe('test harness policy', () => {
  test('keeps repository tests and utilities on the shared harnesses', async () => {
    const files = await glob([...TEST_FILE_GLOBS, ...TEST_UTILITY_GLOBS])
    const violations: string[] = []

    for (const file of files) {
      if (file === POLICY_FILE) continue
      const labels = await analyzeFile(file)
      for (const label of repositoryPolicyLabels) {
        if (labels.has(label) && !isCanonicalPolicyOwner(file, label)) violations.push(`${file}: ${label}`)
      }
    }

    expect(violations).toEqual([])
  })

  test('keeps the hoisted xterm boundary in one canonical harness', async () => {
    const files = await glob(['src/**/*.ts', 'src/**/*.tsx'])
    const violations: string[] = []

    for (const file of files) {
      if (file === CANONICAL_XTERM_MOCK_FILE) continue
      const source = await readFile(file, 'utf8')
      if (hasXtermMock(source, file)) violations.push(file)
    }

    expect(violations).toEqual([])
  })

  test('keeps test surfaces below the oversized-file tripwire', async () => {
    const files = await glob([...TEST_FILE_GLOBS, ...TEST_UTILITY_GLOBS])
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const lineCount = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length
      if (lineCount > MAX_TEST_SURFACE_LINES) {
        violations.push(`${file}: ${lineCount} lines exceeds ${MAX_TEST_SURFACE_LINES}`)
      }
    }

    expect(violations).toEqual([])
  })

  test('uses the shared fake-timer configuration across repository tests and utilities', async () => {
    const files = await glob([...TEST_FILE_GLOBS, ...TEST_UTILITY_GLOBS])
    const violations: string[] = []
    for (const file of files) {
      if (file === POLICY_FILE || file === CANONICAL_TIMERS_FILE) continue
      if ((await analyzeFile(file)).has('direct fake-timer configuration')) violations.push(file)
    }

    expect(violations).toEqual([])
  })

  test('ignores comments, strings, shadowed imports, and unrelated bindings', () => {
    const source = `
      // createRoot(); vi.stubGlobal('fetch'); class MockWebSocket {}
      const documentation = "new KeyboardEvent('keydown'); IS_REACT_ACT_ENVIRONMENT"
      import { vi } from 'vitest'
      import { createRoot } from 'react-dom/client'
      function probe(vi, createRoot, KeyboardEvent, Promise, Object, window, global, globalThis) {
        vi.stubGlobal('fetch')
        vi.useFakeTimers()
        createRoot()
        Object.defineProperty(window, 'localStorage', {})
        global.WebSocket = class TestSocket {}
        globalThis.fetch = fetchMock
        window.localStorage = storage
      }
      const config = { IS_REACT_ACT_ENVIRONMENT: false }
      config.IS_REACT_ACT_ENVIRONMENT = true
      let IS_REACT_ACT_ENVIRONMENT = false
      IS_REACT_ACT_ENVIRONMENT = true
    `

    expect(analyzeSource(source, 'fixture.test.ts')).toEqual(new Set())
  })

  test.each([
    ['hand-rolled React root', "import { createRoot as mount } from 'react-dom/client'; mount(node)"],
    ['act imported directly from React', "import { act as reactAct } from 'react'"],
    ['inline WebSocket mock', 'class FakeWebSocket {}'],
    ['test-local fetch replacement', "import { vi } from 'vitest'; vi.stubGlobal('fetch', fetchMock)"],
    ['test-local fetch replacement', 'globalThis.fetch = fetchMock'],
    ['test-local Storage replacement', "Object.defineProperty(window, 'localStorage', { value: storage })"],
    ['test-local Storage replacement', 'window.sessionStorage = storage'],
    [
      'inline WebSocket mock',
      "import { vi } from 'vitest'; class TestWebSocket {}; vi.stubGlobal('WebSocket', TestWebSocket)",
    ],
    ['inline WebSocket mock', 'globalThis.WebSocket = class TestSocket {}'],
    ['inline WebSocket mock', 'global.WebSocket = class TestSocket {}'],
    ['inline WebSocket mock', "Object.defineProperty(window, 'WebSocket', { value: class TestSocket {} })"],
    ['inline WebSocket mock', "Object.defineProperty(global, 'WebSocket', { value: class TestSocket {} })"],
    ['direct fake-timer configuration', "import { vi as testVi } from 'vitest'; testVi.useFakeTimers()"],
  ] satisfies Array<[PolicyLabel, string]>)('detects %s from syntax bindings', (label, source) => {
    expect(analyzeSource(source, 'fixture.test.tsx')).toContain(label)
  })

  test.each([
    'IS_REACT_ACT_ENVIRONMENT = true',
    'globalThis.IS_REACT_ACT_ENVIRONMENT = true',
    ';(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true',
    `
      const reactActEnvironment = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    `,
  ])('detects act-environment mutation through global syntax and aliases', (source) => {
    expect(analyzeSource(source, 'fixture.test.ts')).toContain('manual React act-environment mutation')
  })

  test('detects xterm mocks through Vitest bindings without matching text', () => {
    expect(hasXtermMock("import { vi as testVi } from 'vitest'; testVi.mock('@xterm/xterm', () => ({}))", 'x.ts')).toBe(
      true,
    )
    expect(
      hasXtermMock("import * as vitest from 'vitest'; vitest.vi.mock('@xterm/addon-fit', () => ({}))", 'x.ts'),
    ).toBe(true)
    expect(hasXtermMock("import { vi } from 'vitest'; vi.mock(import('@xterm/xterm'), () => ({}))", 'x.ts')).toBe(true)
    expect(hasXtermMock("import { vi } from 'vitest'; vi.doMock('@xterm/xterm', () => ({}))", 'x.ts')).toBe(true)
    expect(hasXtermMock('const note = "vi.mock(\'@xterm/xterm\')"', 'x.ts')).toBe(false)
  })
})

function isCanonicalPolicyOwner(file: string, label: (typeof repositoryPolicyLabels)[number]): boolean {
  if (label === 'hand-rolled React root') return !isTestFile(file)
  if (label === 'inline WebSocket mock') return file === CANONICAL_WEBSOCKET_MOCK_FILE
  if (label === 'test-local fetch replacement') return CANONICAL_FETCH_MOCK_FILES.has(file)
  if (label === 'test-local Storage replacement') return file === CANONICAL_STORAGE_FILE
  return false
}

function isTestFile(file: string): boolean {
  return file.endsWith('.test.ts') || file.endsWith('.test.tsx')
}

function analyzeFile(file: string): Promise<ReadonlySet<PolicyLabel>> {
  const cached = analysisByFile.get(file)
  if (cached) return cached
  const analysis = readFile(file, 'utf8').then((source) => analyzeSource(source, file))
  analysisByFile.set(file, analysis)
  return analysis
}

function analyzeSource(source: string, file: string): ReadonlySet<PolicyLabel> {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  })
  const violations = new Set<PolicyLabel>()

  traverse(ast, {
    ImportSpecifier(path) {
      if (importSource(path) === 'react' && importedName(path) === 'act') {
        violations.add('act imported directly from React')
      }
    },
    Class(path) {
      if (path.node.id?.name === 'MockWebSocket' || path.node.id?.name === 'FakeWebSocket') {
        violations.add('inline WebSocket mock')
      }
    },
    AssignmentExpression(path) {
      if (isActEnvironmentTarget(path.get('left'))) violations.add('manual React act-environment mutation')
      if (isGlobalWebSocketTarget(path.get('left'))) violations.add('inline WebSocket mock')
      if (isGlobalNamedTarget(path.get('left'), 'fetch')) violations.add('test-local fetch replacement')
      if (
        isGlobalNamedTarget(path.get('left'), 'localStorage') ||
        isGlobalNamedTarget(path.get('left'), 'sessionStorage')
      ) {
        violations.add('test-local Storage replacement')
      }
    },
    UnaryExpression(path) {
      if (path.node.operator === 'delete' && isActEnvironmentTarget(path.get('argument'))) {
        violations.add('manual React act-environment mutation')
      }
    },
    CallExpression(path) {
      const callee = path.get('callee')
      if (isImportedCreateRoot(callee)) violations.add('hand-rolled React root')
      if (isVitestViMember(callee, 'useFakeTimers')) {
        violations.add('direct fake-timer configuration')
      }
      if (isVitestViMember(callee, 'stubGlobal')) {
        const globalName = stringArgument(path, 0)
        if (globalName === 'fetch') violations.add('test-local fetch replacement')
        if (isStorageName(globalName)) violations.add('test-local Storage replacement')
        if (globalName === 'WebSocket') violations.add('inline WebSocket mock')
      }
      if (isDefinePropertyOnGlobal(path, 'IS_REACT_ACT_ENVIRONMENT')) {
        violations.add('manual React act-environment mutation')
      }
      if (isDefinePropertyOnGlobal(path, 'localStorage') || isDefinePropertyOnGlobal(path, 'sessionStorage')) {
        violations.add('test-local Storage replacement')
      }
      if (isDefinePropertyOnGlobal(path, 'WebSocket')) violations.add('inline WebSocket mock')
    },
  })

  return violations
}

function importSource(path: NodePath): string | null {
  const declaration = path.parentPath
  return declaration?.isImportDeclaration() ? declaration.node.source.value : null
}

function importedName(path: NodePath): string | null {
  if (!path.isImportSpecifier()) return null
  return path.node.imported.type === 'Identifier' ? path.node.imported.name : path.node.imported.value
}

function isImportedIdentifier(path: NodePath, source: string, imported: string): boolean {
  if (!path.isIdentifier()) return false
  const binding = path.scope.getBinding(path.node.name)
  return binding !== undefined && importSource(binding.path) === source && importedName(binding.path) === imported
}

function isImportedNamespace(path: NodePath, source: string): boolean {
  if (!path.isIdentifier()) return false
  const binding = path.scope.getBinding(path.node.name)
  return binding?.path.isImportNamespaceSpecifier() === true && importSource(binding.path) === source
}

function isImportedCreateRoot(callee: NodePath): boolean {
  if (isImportedIdentifier(callee, 'react-dom/client', 'createRoot')) return true
  if (!callee.isMemberExpression() || memberPropertyName(callee) !== 'createRoot') return false
  return isImportedNamespace(callee.get('object'), 'react-dom/client')
}

function isVitestViMember(callee: NodePath, property: string): boolean {
  if (!callee.isMemberExpression() || memberPropertyName(callee) !== property) return false
  const object = callee.get('object')
  if (isImportedIdentifier(object, 'vitest', 'vi')) return true
  return (
    object.isMemberExpression() &&
    memberPropertyName(object) === 'vi' &&
    isImportedNamespace(object.get('object'), 'vitest')
  )
}

function hasXtermMock(source: string, file: string): boolean {
  if (!source.includes('@xterm/')) return false
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  })
  let found = false
  traverse(ast, {
    CallExpression(path) {
      const callee = path.get('callee')
      if (!isVitestViMember(callee, 'mock') && !isVitestViMember(callee, 'doMock')) return
      const moduleName = moduleNameArgument(path)
      if (moduleName?.startsWith('@xterm/')) {
        found = true
        path.stop()
      }
    },
  })
  return found
}

function moduleNameArgument(path: NodePath<CallExpression>): string | null {
  const argument = argumentPaths(path)[0]
  if (argument?.isStringLiteral()) return argument.node.value
  if (argument?.isImportExpression()) {
    const source = argument.get('source')
    return source.isStringLiteral() ? source.node.value : null
  }
  if (!argument?.isCallExpression() || !argument.get('callee').isImport()) return null
  return stringArgument(argument, 0)
}

function memberPropertyName(path: NodePath): string | null {
  if (!path.isMemberExpression()) return null
  const property = path.get('property')
  if (path.node.computed) return property.isStringLiteral() ? property.node.value : null
  return property.isIdentifier() ? property.node.name : null
}

function unwrapExpression(path: NodePath): NodePath {
  let current = path
  while (
    current.isTSAsExpression() ||
    current.isTSSatisfiesExpression() ||
    current.isTSTypeAssertion() ||
    current.isTSNonNullExpression() ||
    current.isParenthesizedExpression()
  ) {
    current = current.get('expression')
  }
  return current
}

function isGlobalObject(path: NodePath, seen = new Set<Binding>()): boolean {
  const expression = unwrapExpression(path)
  if (!expression.isIdentifier()) return false
  const binding = expression.scope.getBinding(expression.node.name)
  if (isGlobalObjectName(expression.node.name) && !binding) return true
  if (!binding || seen.has(binding) || !binding.path.isVariableDeclarator()) return false
  const initializer = binding.path.get('init')
  if (!initializer.node) return false
  seen.add(binding)
  return isGlobalObject(initializer, seen)
}

function isGlobalObjectName(name: string): boolean {
  return name === 'globalThis' || name === 'global' || name === 'window'
}

function isActEnvironmentTarget(path: NodePath): boolean {
  const target = unwrapExpression(path)
  if (isUnboundIdentifier(target, 'IS_REACT_ACT_ENVIRONMENT')) return true
  if (!target.isMemberExpression() || memberPropertyName(target) !== 'IS_REACT_ACT_ENVIRONMENT') return false
  return isGlobalObject(target.get('object'))
}

function isUnboundIdentifier(path: NodePath, name: string): boolean {
  return path.isIdentifier({ name }) && path.scope.getBinding(name) === undefined
}

function isGlobalMember(path: NodePath, property: string): boolean {
  return path.isMemberExpression() && memberPropertyName(path) === property && isGlobalObject(path.get('object'))
}

function isGlobalWebSocketTarget(path: NodePath): boolean {
  const target = unwrapExpression(path)
  return isUnboundIdentifier(target, 'WebSocket') || isGlobalMember(target, 'WebSocket')
}

function isGlobalNamedTarget(path: NodePath, name: string): boolean {
  const target = unwrapExpression(path)
  return isUnboundIdentifier(target, name) || isGlobalMember(target, name)
}

function stringArgument(path: NodePath, index: number): string | null {
  const argument = argumentPaths(path)[index]
  return argument?.isStringLiteral() ? argument.node.value : null
}

function argumentPaths(path: NodePath): NodePath[] {
  const argumentsPath = path.get('arguments')
  return Array.isArray(argumentsPath) ? argumentsPath : []
}

function isDefinePropertyOnGlobal(path: NodePath, property: string): boolean {
  if (!path.isCallExpression()) return false
  const callee = path.get('callee')
  if (!callee.isMemberExpression() || memberPropertyName(callee) !== 'defineProperty') return false
  if (!isUnboundIdentifier(callee.get('object'), 'Object')) return false
  const target = argumentPaths(path)[0]
  return target !== undefined && isGlobalObject(target) && stringArgument(path, 1) === property
}

function isStorageName(value: string | null): boolean {
  return value === 'localStorage' || value === 'sessionStorage'
}
