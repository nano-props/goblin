// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AcceptedTerminalRetirement } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { primaryWindowNavigationActionsForTest } from '#/web/test-utils/primary-window-navigation.ts'
import type { RetiredTerminalWorkspacePaneTabPresentationPlan } from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import {
  beginPrimaryWindowNavigationIntent,
  resetPrimaryWindowNavigationForTest,
  tryBeginPassivePrimaryWindowNavigationIntent,
  type PrimaryWindowNavigationIntent,
} from '#/web/primary-window-navigation-lifecycle.ts'

const mocks = vi.hoisted(() => ({
  listener: null as ((retirement: AcceptedTerminalRetirement) => void) | null,
  unsubscribe: vi.fn(),
  capturePresentation: vi.fn(),
  commitPresentation: vi.fn(),
  projection: {
    subscribeAcceptedRetirement: vi.fn(),
  },
}))

vi.mock('#/web/components/terminal/use-terminal-session-projection.ts', () => ({
  useTerminalSessionProjection: () => mocks.projection,
}))

vi.mock('#/web/workspace-pane/workspace-pane-tab-close-action.ts', () => ({
  captureRetiredTerminalWorkspacePaneTabPresentationPlan: mocks.capturePresentation,
  commitRetiredTerminalWorkspacePaneTabPresentationPlan: mocks.commitPresentation,
}))

import { useTerminalRetirementWorkspacePanePresentation } from '#/web/workspace-pane/use-terminal-retirement-workspace-pane-presentation.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-exit-presentation-workspace')
const TERMINAL_SESSION_ID = 'term-111111111111111111111'
const ROUTE_TARGET = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }
const TERMINAL_ROUTE = { kind: 'terminal' as const, terminalSessionId: TERMINAL_SESSION_ID }

function presentationPlanForTest(): RetiredTerminalWorkspacePaneTabPresentationPlan {
  return {
    terminalSessionId: TERMINAL_SESSION_ID,
    target: {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-1',
      routeTarget: ROUTE_TARGET,
      paneTarget: ROUTE_TARGET,
    },
  } as RetiredTerminalWorkspacePaneTabPresentationPlan
}

function retirementForTest(invalidation = new AbortController()): AcceptedTerminalRetirement {
  return {
    terminalSessionId: TERMINAL_SESSION_ID,
    base: {
      target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
      presentation: { kind: 'workspace-root' },
    },
    retirementPresentation: {
      target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
      terminalBase: {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
        presentation: { kind: 'workspace-root' },
      },
      tabsBeforeRetirement: [],
    },
    invalidationSignal: invalidation.signal,
    settle: vi.fn(),
    release: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }
}

async function flushPresentation(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetPrimaryWindowNavigationForTest()
  mocks.listener = null
  mocks.unsubscribe.mockReset()
  mocks.capturePresentation.mockReset()
  mocks.capturePresentation.mockReturnValue(presentationPlanForTest())
  mocks.commitPresentation.mockReset()
  mocks.commitPresentation.mockImplementation(
    async (
      _plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
      _navigation: unknown,
      intent: PrimaryWindowNavigationIntent,
    ) => {
      intent.commit()
      return true
    },
  )
  mocks.projection.subscribeAcceptedRetirement.mockReset()
  mocks.projection.subscribeAcceptedRetirement.mockImplementation(
    (listener: (retirement: AcceptedTerminalRetirement) => void) => {
      mocks.listener = listener
      return mocks.unsubscribe
    },
  )
})

function renderPresentationHook() {
  return renderHook(
    ({ route }: { route: typeof TERMINAL_ROUTE | { kind: 'static'; tab: 'files' } }) =>
      useTerminalRetirementWorkspacePanePresentation({
        currentRouteTarget: ROUTE_TARGET,
        currentWorkspacePaneRoute: route,
        navigation: primaryWindowNavigationActionsForTest(),
      }),
    { initialProps: { route: TERMINAL_ROUTE as typeof TERMINAL_ROUTE | { kind: 'static'; tab: 'files' } } },
  )
}

function renderHydratingPresentationHook() {
  type Props = {
    target: typeof ROUTE_TARGET | null
    route: typeof TERMINAL_ROUTE | { kind: 'static'; tab: 'files' }
  }
  return renderHook(
    ({ target, route }: Props) =>
      useTerminalRetirementWorkspacePanePresentation({
        currentRouteTarget: target,
        currentWorkspacePaneRoute: route,
        navigation: primaryWindowNavigationActionsForTest(),
      }),
    { initialProps: { target: null, route: TERMINAL_ROUTE } as Props },
  )
}

test('captures and commits an accepted active-terminal retirement', async () => {
  const { unmount } = renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')

  act(() => listener(retirementForTest()))
  await flushPresentation()

  expect(mocks.capturePresentation).toHaveBeenCalledWith({
    routeTarget: ROUTE_TARGET,
    workspacePaneRoute: TERMINAL_ROUTE,
    terminalSessionId: TERMINAL_SESSION_ID,
    terminalBase: retirementForTest().base,
    retirementPresentation: retirementForTest().retirementPresentation,
  })
  expect(mocks.commitPresentation).toHaveBeenCalledOnce()

  unmount()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

test('retains an accepted retirement until its exact route target hydrates', async () => {
  const { rerender } = renderHydratingPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')
  const retirement = retirementForTest()

  act(() => listener(retirement))
  expect(mocks.capturePresentation).not.toHaveBeenCalled()
  expect(retirement.settle).not.toHaveBeenCalled()

  rerender({ target: ROUTE_TARGET, route: TERMINAL_ROUTE })
  await flushPresentation()

  expect(mocks.capturePresentation).toHaveBeenCalledOnce()
  expect(mocks.commitPresentation).toHaveBeenCalledOnce()
  expect(retirement.settle).toHaveBeenCalledOnce()
})

test('settles an awaiting-target retirement when the route definitively leaves its terminal', () => {
  const { rerender } = renderHydratingPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')
  const retirement = retirementForTest()

  act(() => listener(retirement))
  rerender({ target: null, route: { kind: 'static', tab: 'files' } })

  expect(mocks.capturePresentation).not.toHaveBeenCalled()
  expect(retirement.settle).toHaveBeenCalledOnce()
})

test('waits for an admitted user command before admitting passive close-back', async () => {
  const userIntent = beginPrimaryWindowNavigationIntent('user')
  renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')

  act(() => listener(retirementForTest()))
  await flushPresentation()
  expect(mocks.commitPresentation).not.toHaveBeenCalled()

  act(() => userIntent.release())
  await flushPresentation()
  expect(mocks.commitPresentation).toHaveBeenCalledOnce()
})

test('abandons a waiting retirement when catalog reconciliation invalidates its lease', async () => {
  const userIntent = beginPrimaryWindowNavigationIntent('user')
  renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')
  const invalidation = new AbortController()
  const retirement = retirementForTest(invalidation)

  act(() => listener(retirement))
  await flushPresentation()
  act(() => invalidation.abort())

  expect(retirement.settle).toHaveBeenCalledOnce()
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
  act(() => userIntent.release())
  await flushPresentation()
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
})

test('abandons a waiting plan immediately when its exact source route changes', async () => {
  const userIntent = beginPrimaryWindowNavigationIntent('user')
  const { rerender } = renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')
  const retirement = retirementForTest()

  act(() => listener(retirement))
  await flushPresentation()
  rerender({ route: { kind: 'static', tab: 'files' } })

  expect(retirement.settle).toHaveBeenCalledOnce()
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
  act(() => userIntent.release())
  await flushPresentation()
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
})

test('retries a passive presentation superseded by a user intent after that user settles', async () => {
  const firstCommit = Promise.withResolvers<boolean>()
  mocks.commitPresentation.mockImplementationOnce(async () => await firstCommit.promise)
  renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')

  act(() => listener(retirementForTest()))
  await flushPresentation()
  expect(mocks.commitPresentation).toHaveBeenCalledOnce()

  const userIntent = beginPrimaryWindowNavigationIntent('user')
  firstCommit.resolve(false)
  await flushPresentation()
  expect(mocks.commitPresentation).toHaveBeenCalledOnce()

  act(() => userIntent.release())
  await flushPresentation()
  expect(mocks.commitPresentation).toHaveBeenCalledTimes(2)
})

test('does not retry a passive navigation that failed without being superseded', async () => {
  mocks.commitPresentation.mockImplementationOnce(
    async (
      _plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
      _navigation: unknown,
      intent: PrimaryWindowNavigationIntent,
    ) => {
      intent.fail(new Error('blocked'))
      return false
    },
  )
  renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')

  act(() => listener(retirementForTest()))
  await flushPresentation()

  expect(mocks.commitPresentation).toHaveBeenCalledOnce()
  const next = tryBeginPassivePrimaryWindowNavigationIntent()
  expect(next.kind).toBe('admitted')
  if (next.kind === 'admitted') next.intent.release()
})

test('unmount abandons an active passive intent and ignores its late completion', async () => {
  const commit = Promise.withResolvers<boolean>()
  mocks.commitPresentation.mockImplementationOnce(async () => await commit.promise)
  const { unmount } = renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')

  act(() => listener(retirementForTest()))
  await flushPresentation()
  unmount()
  commit.resolve(true)
  await flushPresentation()

  const next = tryBeginPassivePrimaryWindowNavigationIntent()
  expect(next.kind).toBe('admitted')
  if (next.kind === 'admitted') next.intent.release()
})

test('ignores an accepted retirement that cannot produce an active-route plan', () => {
  mocks.capturePresentation.mockReturnValue(null)
  renderPresentationHook()
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-retirement listener')

  act(() => listener(retirementForTest()))

  expect(mocks.capturePresentation).toHaveBeenCalledOnce()
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
})
