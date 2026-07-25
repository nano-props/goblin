// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AcceptedTerminalRetirement } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { primaryWindowNavigationActionsForTest } from '#/web/test-utils/primary-window-navigation.ts'
import type { RetiredTerminalWorkspacePaneTabPresentationPlan } from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'

const mocks = vi.hoisted(() => ({
  listener: null as ((retirement: AcceptedTerminalRetirement) => void) | null,
  unsubscribe: vi.fn(),
  capturePresentation: vi.fn(),
  commitPresentation: vi.fn(async () => true),
  abandonPresentation: vi.fn(),
  targetMatches: vi.fn(() => true),
  projection: {
    subscribeAcceptedRetirement: vi.fn(),
  },
}))

vi.mock('#/web/components/terminal/use-terminal-session-projection.ts', () => ({
  useTerminalSessionProjection: () => mocks.projection,
}))

vi.mock('#/web/commands/workspace-commands.ts', () => ({
  captureRetiredTerminalWorkspacePaneTabPresentationCommand: mocks.capturePresentation,
  commitRetiredTerminalWorkspacePaneTabPresentationCommand: mocks.commitPresentation,
  abandonRetiredTerminalWorkspacePaneTabPresentationCommand: mocks.abandonPresentation,
  retiredTerminalWorkspacePaneTabPresentationPlanMatchesCommandTarget: mocks.targetMatches,
}))

import { useTerminalRetirementWorkspacePanePresentation } from '#/web/workspace-pane/use-terminal-retirement-workspace-pane-presentation.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-exit-presentation-workspace')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-exit-presentation-other')

beforeEach(() => {
  mocks.listener = null
  mocks.unsubscribe.mockReset()
  mocks.capturePresentation.mockReset()
  mocks.commitPresentation.mockReset()
  mocks.commitPresentation.mockResolvedValue(true)
  mocks.abandonPresentation.mockReset()
  mocks.targetMatches.mockReset()
  mocks.targetMatches.mockReturnValue(true)
  mocks.projection.subscribeAcceptedRetirement.mockReset()
  mocks.projection.subscribeAcceptedRetirement.mockImplementation(
    (listener: (retirement: AcceptedTerminalRetirement) => void) => {
      mocks.listener = listener
      return mocks.unsubscribe
    },
  )
})

test('retains a captured retirement plan until the hydrated command target can validate it', async () => {
  const navigation = primaryWindowNavigationActionsForTest()
  const terminalSessionId = 'term-111111111111111111111'
  const routeTarget = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }
  const workspacePaneRoute = { kind: 'terminal' as const, terminalSessionId }
  const plan = {
    terminalSessionId,
    routeTarget,
    sourceRoute: workspacePaneRoute,
  } as RetiredTerminalWorkspacePaneTabPresentationPlan
  mocks.capturePresentation.mockReturnValue(plan)
  const { rerender, unmount } = renderHook(
    ({ currentTarget }: { currentTarget: WorkspacePaneCommandTarget | null }) =>
      useTerminalRetirementWorkspacePanePresentation({
        currentRouteTarget: routeTarget,
        currentWorkspacePaneRoute: workspacePaneRoute,
        currentTarget,
        navigation,
      }),
    { initialProps: { currentTarget: null as WorkspacePaneCommandTarget | null } },
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')
  const descriptor = {
    terminalSessionId,
    index: 1,
    target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
    presentation: { kind: 'workspace-root' as const },
  }

  await act(async () => {
    listener({ terminalSessionId: descriptor.terminalSessionId, base: descriptor })
    await Promise.resolve()
  })

  expect(mocks.capturePresentation).toHaveBeenCalledWith({
    routeTarget,
    workspacePaneRoute,
    terminalSessionId,
    terminalBase: descriptor,
  })
  expect(mocks.commitPresentation).not.toHaveBeenCalled()

  const hydratedTarget = {
    routeTarget,
    workspacePaneRoute,
    filesystemTarget: {},
  } as WorkspacePaneCommandTarget
  rerender({ currentTarget: hydratedTarget })
  await act(async () => await Promise.resolve())

  expect(mocks.targetMatches).toHaveBeenCalledWith(plan, hydratedTarget)
  expect(mocks.commitPresentation).toHaveBeenCalledWith(plan, navigation)

  unmount()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  expect(mocks.abandonPresentation).not.toHaveBeenCalled()
})

test('abandons a captured retirement plan when the router leaves its exact source', () => {
  const navigation = primaryWindowNavigationActionsForTest()
  const terminalSessionId = 'term-111111111111111111111'
  const routeTarget = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }
  const workspacePaneRoute = { kind: 'terminal' as const, terminalSessionId }
  const plan = {
    terminalSessionId,
    routeTarget,
    sourceRoute: workspacePaneRoute,
  } as RetiredTerminalWorkspacePaneTabPresentationPlan
  mocks.capturePresentation.mockReturnValue(plan)
  mocks.targetMatches.mockReturnValue(false)
  const { rerender } = renderHook(
    ({ route }: { route: typeof workspacePaneRoute | { kind: 'static'; tab: 'files' } }) =>
      useTerminalRetirementWorkspacePanePresentation({
        currentRouteTarget: routeTarget,
        currentWorkspacePaneRoute: route,
        currentTarget: null,
        navigation,
      }),
    {
      initialProps: {
        route: workspacePaneRoute as typeof workspacePaneRoute | { kind: 'static'; tab: 'files' },
      },
    },
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')

  act(() => {
    listener({
      terminalSessionId,
      base: {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
        presentation: { kind: 'workspace-root' },
      },
    })
  })
  rerender({ route: { kind: 'static', tab: 'files' } })

  expect(mocks.abandonPresentation).toHaveBeenCalledOnce()
  expect(mocks.abandonPresentation).toHaveBeenCalledWith(plan)
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
})

test('abandons a retained retirement plan on unmount', () => {
  const terminalSessionId = 'term-111111111111111111111'
  const routeTarget = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }
  const workspacePaneRoute = { kind: 'terminal' as const, terminalSessionId }
  const plan = {
    terminalSessionId,
    routeTarget,
    sourceRoute: workspacePaneRoute,
  } as RetiredTerminalWorkspacePaneTabPresentationPlan
  mocks.capturePresentation.mockReturnValue(plan)
  const { unmount } = renderHook(() =>
    useTerminalRetirementWorkspacePanePresentation({
      currentRouteTarget: routeTarget,
      currentWorkspacePaneRoute: workspacePaneRoute,
      currentTarget: null,
      navigation: primaryWindowNavigationActionsForTest(),
    }),
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')

  act(() => {
    listener({
      terminalSessionId,
      base: {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
        presentation: { kind: 'workspace-root' },
      },
    })
  })
  unmount()

  expect(mocks.abandonPresentation).toHaveBeenCalledOnce()
  expect(mocks.abandonPresentation).toHaveBeenCalledWith(plan)
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
})

test('ignores an accepted exit from a background workspace', () => {
  mocks.capturePresentation.mockReturnValue(null)
  const routeTarget = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }
  renderHook(() =>
    useTerminalRetirementWorkspacePanePresentation({
      currentRouteTarget: routeTarget,
      currentWorkspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      currentTarget: null,
      navigation: primaryWindowNavigationActionsForTest(),
    }),
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')

  act(() => {
    listener({
      terminalSessionId: 'term-222222222222222222222',
      base: {
        target: { kind: 'workspace-root', workspaceId: OTHER_WORKSPACE_ID, workspaceRuntimeId: 'runtime-2' },
        presentation: { kind: 'workspace-root' },
      },
    })
  })

  expect(mocks.capturePresentation).toHaveBeenCalled()
  expect(mocks.commitPresentation).not.toHaveBeenCalled()
})
