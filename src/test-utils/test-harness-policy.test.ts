import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import traverse, { type Binding, type NodePath } from '@babel/traverse'
import type { CallExpression } from '@babel/types'
import { describe, expect, test } from 'vitest'
import { glob } from 'tinyglobby'

const POLICY_FILE = 'src/test-utils/test-harness-policy.test.ts'
const CANONICAL_WEBSOCKET_MOCK_FILE = 'src/web/test-utils/websocket-mock.ts'
const CANONICAL_XTERM_MOCK_FILE = 'src/web/test-utils/terminal-session.ts'
const CANONICAL_KEYBOARD_EVENT_FILE = 'src/web/test-utils/keyboard-event.ts'
const CANONICAL_TIMERS_FILE = 'src/test-utils/timers.ts'
const CANONICAL_MICROTASKS_FILE = 'src/test-utils/microtasks.ts'
const CANONICAL_FETCH_MOCK_FILES = new Set(['src/test-utils/fetch-mock.ts', 'src/web/test-utils/bridge.ts'])
const DEFAULT_TEST_FILE_LINE_BUDGET = 1_000
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
  'repeated manual microtask drain',
  'test-local zero-delay macrotask wait',
  'test-local fetch replacement',
  'test-local Storage replacement',
] as const

type PolicyLabel =
  (typeof repositoryPolicyLabels)[number] | 'direct KeyboardEvent construction' | 'direct fake-timer configuration'

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

  test('keeps test helpers on the canonical WebSocket mock', async () => {
    const files = await glob(TEST_UTILITY_GLOBS)
    const violations: string[] = []

    for (const file of files) {
      if (file === POLICY_FILE || file === CANONICAL_WEBSOCKET_MOCK_FILE) continue
      if ((await analyzeFile(file)).has('inline WebSocket mock')) violations.push(file)
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

  test('keeps component test filenames aligned with their source surfaces', async () => {
    const files = await glob(['src/**/*.component.test.ts', 'src/**/*.component.test.tsx'])

    expect(files).toEqual([])
  })

  test('keeps every test file within the structural line budget', async () => {
    const files = await glob(TEST_FILE_GLOBS)
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const lineCount = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length
      if (lineCount > DEFAULT_TEST_FILE_LINE_BUDGET)
        violations.push(`${file}: ${lineCount} lines exceeds ${DEFAULT_TEST_FILE_LINE_BUDGET}`)
    }

    expect(violations).toEqual([])
  })

  test('keeps shared test utilities within the structural line budget', async () => {
    const files = await glob(TEST_UTILITY_GLOBS)
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const lineCount = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length
      if (lineCount > DEFAULT_TEST_FILE_LINE_BUDGET)
        violations.push(`${file}: ${lineCount} lines exceeds ${DEFAULT_TEST_FILE_LINE_BUDGET}`)
    }

    expect(violations).toEqual([])
  })

  test('keeps test and test-utility runtime imports live', async () => {
    const files = await glob([...TEST_FILE_GLOBS, ...TEST_UTILITY_GLOBS])
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const name of unusedRuntimeImportNames(source, file)) violations.push(`${file}: ${name}`)
    }

    expect(violations).toEqual([])
  })

  test('keeps every test under a named suite', async () => {
    const files = await glob(TEST_FILE_GLOBS)
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (!hasOnlyTestsInNamedSuites(source, file)) violations.push(file)
    }

    expect(violations).toEqual([])
  })

  test('recognizes only tests wrapped by named Vitest suites', () => {
    expect(
      hasOnlyTestsInNamedSuites(
        "import { describe, test } from 'vitest'; describe('suite', () => { test('case', () => {}) })",
        'fixture.test.ts',
      ),
    ).toBe(true)
    expect(
      hasOnlyTestsInNamedSuites(
        "import { describe, test } from 'vitest'; describe('suite', () => {}); test('outside', () => {})",
        'fixture.test.ts',
      ),
    ).toBe(false)
    expect(
      hasOnlyTestsInNamedSuites(
        "import { describe, test } from 'vitest'; describe(() => { test('case', () => {}) })",
        'fixture.test.ts',
      ),
    ).toBe(false)
    expect(
      hasOnlyTestsInNamedSuites(
        "import { describe, test } from 'vitest'; describe('suite'); test('outside', () => {})",
        'fixture.test.ts',
      ),
    ).toBe(false)
    expect(
      hasOnlyTestsInNamedSuites(
        "import { describe, test } from 'vitest'; describe.each([1])('suite', () => { test.each([1])('case', () => {}) })",
        'fixture.test.ts',
      ),
    ).toBe(true)
    expect(
      hasOnlyTestsInNamedSuites(
        "import { describe as suite, it as spec } from 'vitest'; suite.only('named', () => { spec.skip('case', () => {}) })",
        'fixture.test.ts',
      ),
    ).toBe(true)
    expect(
      hasOnlyTestsInNamedSuites(
        "import * as v from 'vitest'; v.describe('named', () => { v.test('case', () => {}) })",
        'fixture.test.ts',
      ),
    ).toBe(true)
    expect(
      hasOnlyTestsInNamedSuites(
        "import { describe, test } from 'vitest'; const extended = test.extend({}); describe('named', () => { test('case', () => {}) })",
        'fixture.test.ts',
      ),
    ).toBe(true)
    expect(
      hasOnlyTestsInNamedSuites(
        "function describe() {}; function test() {}; describe('local', () => { test('case', () => {}) })",
        'fixture.test.ts',
      ),
    ).toBe(false)
  })

  test('keeps raw keyboard event construction behind the listener-contract helper', async () => {
    const files = await glob([...TEST_FILE_GLOBS, ...TEST_UTILITY_GLOBS])
    const violations: string[] = []
    for (const file of files) {
      if (file === CANONICAL_KEYBOARD_EVENT_FILE) continue
      if ((await analyzeFile(file)).has('direct KeyboardEvent construction')) violations.push(file)
    }

    expect(violations).toEqual([])
  })

  test('uses the shared fake-timer configuration across repository tests', async () => {
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
        new KeyboardEvent('keydown')
        new Promise((resolve) => window.setTimeout(resolve, 0))
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
    ['repeated manual microtask drain', 'await Promise.resolve(); await Promise.resolve()'],
    ['repeated manual microtask drain', 'for (let i = 0; i < 3; i += 1) await Promise.resolve()'],
    ['test-local zero-delay macrotask wait', 'await new Promise((resolve) => setTimeout(resolve, 0))'],
    ['test-local zero-delay macrotask wait', 'await new Promise((resolve) => setTimeout(resolve))'],
    ['test-local zero-delay macrotask wait', 'await new Promise((resolve) => setTimeout(resolve, undefined))'],
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
    ['test-local zero-delay macrotask wait', 'await new Promise((resolve) => setTimeout(resolve, 0 as number))'],
    [
      'test-local zero-delay macrotask wait',
      'await new Promise((resolve) => setTimeout(resolve, undefined as undefined))',
    ],
    ['test-local zero-delay macrotask wait', 'await new Promise((resolve) => setTimeout(resolve, 0 satisfies number))'],
    ['direct KeyboardEvent construction', "new KeyboardEvent('keydown')"],
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

  test('recognizes direct zero-delay Promise settlement without inferring callback aliases', () => {
    expect(analyzeSource('new Promise((resolve) => { setTimeout(sideEffect, 0); resolve() })', 'x.ts')).not.toContain(
      'test-local zero-delay macrotask wait',
    )
    expect(
      analyzeSource(
        'new Promise((resolve) => { const schedule = () => setTimeout(sideEffect, 0); resolve() })',
        'x.ts',
      ),
    ).not.toContain('test-local zero-delay macrotask wait')
    expect(analyzeSource('new Promise((resolve) => setTimeout(() => resolve(), 0))', 'x.ts')).toContain(
      'test-local zero-delay macrotask wait',
    )
    expect(analyzeSource('new Promise((_resolve, reject) => setTimeout(reject, 0))', 'x.ts')).toContain(
      'test-local zero-delay macrotask wait',
    )
    expect(
      analyzeSource('new Promise((resolve) => { setTimeout(() => console.log(resolve), 0); resolve() })', 'x.ts'),
    ).not.toContain('test-local zero-delay macrotask wait')
    expect(
      analyzeSource('new Promise((resolve) => { const finish = () => resolve(); setTimeout(finish, 0) })', 'x.ts'),
    ).not.toContain('test-local zero-delay macrotask wait')
  })
})

function isCanonicalPolicyOwner(file: string, label: (typeof repositoryPolicyLabels)[number]): boolean {
  if (label === 'inline WebSocket mock') return file === CANONICAL_WEBSOCKET_MOCK_FILE
  if (label === 'repeated manual microtask drain' || label === 'test-local zero-delay macrotask wait') {
    return file === CANONICAL_MICROTASKS_FILE
  }
  if (label === 'test-local fetch replacement') return CANONICAL_FETCH_MOCK_FILES.has(file)
  return false
}

function analyzeFile(file: string): Promise<ReadonlySet<PolicyLabel>> {
  const cached = analysisByFile.get(file)
  if (cached) return cached
  const analysis = readFile(file, 'utf8').then((source) => analyzeSource(source, file))
  analysisByFile.set(file, analysis)
  return analysis
}

function hasOnlyTestsInNamedSuites(source: string, file: string): boolean {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  })
  let foundTest = false
  let valid = true
  traverse(ast, {
    CallExpression(path) {
      if (!isOutermostVitestCall(path, ['test', 'it'])) return
      foundTest = true
      if (hasNamedSuiteAncestor(path)) return
      valid = false
      path.stop()
    },
  })
  return foundTest && valid
}

function unusedRuntimeImportNames(source: string, file: string): string[] {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  })
  const names: string[] = []
  traverse(ast, {
    Program(path) {
      for (const [name, binding] of Object.entries(path.scope.bindings)) {
        const declaration = binding.path.parentPath
        const typeOnly =
          (binding.path.isImportSpecifier() && binding.path.node.importKind === 'type') ||
          (declaration?.isImportDeclaration() && declaration.node.importKind === 'type')
        if (binding.kind === 'module' && !binding.referenced && !typeOnly) names.push(name)
      }
      path.stop()
    },
  })
  return names
}

function hasNamedSuiteAncestor(path: NodePath<CallExpression>): boolean {
  let ancestor: NodePath | null = path.parentPath
  while (ancestor) {
    if (ancestor.isCallExpression() && isOutermostVitestCall(ancestor, ['describe'])) {
      const [name, ...remainingArguments] = argumentPaths(ancestor)
      const callback = remainingArguments.at(-1)
      if (
        name?.isStringLiteral() &&
        name.node.value.trim().length > 0 &&
        (callback?.isFunctionExpression() || callback?.isArrowFunctionExpression())
      ) {
        return true
      }
    }
    ancestor = ancestor.parentPath
  }
  return false
}

function isOutermostVitestCall(path: NodePath<CallExpression>, imports: readonly string[]): boolean {
  const parent = path.parentPath
  if (parent?.isCallExpression() && parent.get('callee').node === path.node) return false

  const directCallee = path.get('callee')
  if (
    directCallee.isMemberExpression() &&
    ['each', 'extend', 'for', 'runIf', 'skipIf'].includes(memberPropertyName(directCallee) ?? '')
  ) {
    return false
  }

  let callee: NodePath = directCallee
  const memberNames: string[] = []
  while (callee.isCallExpression() || callee.isMemberExpression()) {
    if (callee.isCallExpression()) {
      callee = callee.get('callee')
    } else {
      const memberName = memberPropertyName(callee)
      if (memberName) memberNames.unshift(memberName)
      callee = callee.get('object')
    }
  }
  return (
    imports.some((imported) => isImportedIdentifier(callee, 'vitest', imported)) ||
    (isImportedNamespace(callee, 'vitest') && memberNames[0] !== undefined && imports.includes(memberNames[0]))
  )
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
    Program(path) {
      detectRepeatedMicrotaskDrain(path.get('body'), violations)
    },
    BlockStatement(path) {
      detectRepeatedMicrotaskDrain(path.get('body'), violations)
    },
    ForStatement(path) {
      if (containsAwaitPromiseResolve(path.get('body'))) violations.add('repeated manual microtask drain')
    },
    ForInStatement(path) {
      if (containsAwaitPromiseResolve(path.get('body'))) violations.add('repeated manual microtask drain')
    },
    ForOfStatement(path) {
      if (containsAwaitPromiseResolve(path.get('body'))) violations.add('repeated manual microtask drain')
    },
    WhileStatement(path) {
      if (containsAwaitPromiseResolve(path.get('body'))) violations.add('repeated manual microtask drain')
    },
    DoWhileStatement(path) {
      if (containsAwaitPromiseResolve(path.get('body'))) violations.add('repeated manual microtask drain')
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
    NewExpression(path) {
      const callee = path.get('callee')
      if (isUnboundIdentifier(callee, 'KeyboardEvent')) violations.add('direct KeyboardEvent construction')
      if (isUnboundIdentifier(callee, 'Promise') && containsZeroDelayTimeout(path)) {
        violations.add('test-local zero-delay macrotask wait')
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

function isGlobalFunction(path: NodePath, name: string): boolean {
  return isUnboundIdentifier(path, name) || isGlobalMember(path, name)
}

function isGlobalWebSocketTarget(path: NodePath): boolean {
  const target = unwrapExpression(path)
  return isUnboundIdentifier(target, 'WebSocket') || isGlobalMember(target, 'WebSocket')
}

function isGlobalNamedTarget(path: NodePath, name: string): boolean {
  const target = unwrapExpression(path)
  return isUnboundIdentifier(target, name) || isGlobalMember(target, name)
}

function containsZeroDelayTimeout(promisePath: NodePath): boolean {
  const executor = argumentPaths(promisePath)[0]
  if (!executor?.isFunction()) return false
  const settlementBindings = executor
    .get('params')
    .slice(0, 2)
    .flatMap((parameter) => {
      if (!parameter.isIdentifier()) return []
      const binding = executor.scope.getBinding(parameter.node.name)
      return binding ? [binding] : []
    })
  if (settlementBindings.length === 0) return false
  let found = false
  executor.traverse({
    CallExpression(path: NodePath<CallExpression>) {
      if (!isGlobalFunction(path.get('callee'), 'setTimeout')) return
      const callback = argumentPaths(path)[0]
      if (!callback || !directlySettlesPromise(callback, settlementBindings)) return
      const delay = argumentPaths(path)[1]
      const delayExpression = delay && unwrapExpression(delay)
      if (
        delayExpression === undefined ||
        delayExpression.isNumericLiteral({ value: 0 }) ||
        isUnboundIdentifier(delayExpression, 'undefined')
      ) {
        found = true
      }
    },
  })
  return found
}

function directlySettlesPromise(path: NodePath, bindings: readonly Binding[]): boolean {
  const expression = unwrapExpression(path)
  if (expression.isIdentifier()) return bindings.includes(expression.scope.getBinding(expression.node.name) as Binding)
  if (!expression.isFunction()) return false
  let found = false
  expression.traverse({
    Function(innerPath) {
      innerPath.skip()
    },
    CallExpression(callPath) {
      const callee = unwrapExpression(callPath.get('callee'))
      if (callee.isIdentifier() && bindings.includes(callee.scope.getBinding(callee.node.name) as Binding)) {
        found = true
        callPath.stop()
      }
    },
  })
  return found
}

function detectRepeatedMicrotaskDrain(statements: NodePath[], violations: Set<PolicyLabel>): void {
  let consecutive = 0
  for (const statement of statements) {
    consecutive = isAwaitPromiseResolve(statement) ? consecutive + 1 : 0
    if (consecutive === 2) violations.add('repeated manual microtask drain')
  }
}

function isAwaitPromiseResolve(statement: NodePath): boolean {
  if (!statement.isExpressionStatement()) return false
  const expression = statement.get('expression')
  if (!expression.isAwaitExpression()) return false
  const argument = expression.get('argument')
  if (!argument.isCallExpression() || argument.node.arguments.length !== 0) return false
  const callee = argument.get('callee')
  return (
    callee.isMemberExpression() &&
    memberPropertyName(callee) === 'resolve' &&
    isUnboundIdentifier(callee.get('object'), 'Promise')
  )
}

function containsAwaitPromiseResolve(path: NodePath): boolean {
  let found = false
  path.traverse({
    Function(innerPath) {
      innerPath.skip()
    },
    AwaitExpression(innerPath) {
      const argument = innerPath.get('argument')
      if (!argument.isCallExpression() || argument.node.arguments.length !== 0) return
      const callee = argument.get('callee')
      if (
        callee.isMemberExpression() &&
        memberPropertyName(callee) === 'resolve' &&
        isUnboundIdentifier(callee.get('object'), 'Promise')
      ) {
        found = true
        innerPath.stop()
      }
    },
  })
  return found
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
