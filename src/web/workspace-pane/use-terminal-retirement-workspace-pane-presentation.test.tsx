// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AcceptedTerminalRetirement } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { primaryWindowNavigationActionsForTest } from '#/web/test-utils/primary-window-navigation.ts'
import type { RetiredTerminalWorkspacePaneTabPresentationPlan } from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

const mocks = vi.hoisted(() => ({
  listener: null as ((retirement: AcceptedTerminalRetirement) => void) | null,
  unsubscribe: vi.fn(),
  capturePresentation: vi.fn(),
  commitPresentation: vi.fn(async () => true),
  abandonPresentation: vi.fn(),
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
  abandonRetiredTerminalWorkspacePaneTabPresentationPlan: mocks.abandonPresentation,
}))

import { useTerminalRetirementWorkspacePanePresentation } from '#/web/workspace-pane/use-terminal-retirement-workspace-pane-presentation.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-exit-presentation-workspace')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-exit-presentation-other')

function presentationPlanForTest(
  terminalSessionId: string,
  routeTarget: { kind: 'workspace-root'; workspaceId: typeof WORKSPACE_ID },
): RetiredTerminalWorkspacePaneTabPresentationPlan {
  return {
    terminalSessionId,
    target: {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-1',
      routeTarget,
      paneTarget: routeTarget,
    },
  } as RetiredTerminalWorkspacePaneTabPresentationPlan
}

beforeEach(() => {
  mocks.listener = null
  mocks.unsubscribe.mockReset()
  mocks.capturePresentation.mockReset()
  mocks.commitPresentation.mockReset()
  mocks.commitPresentation.mockResolvedValue(true)
  mocks.abandonPresentation.mockReset()
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
  const descriptor = {
    terminalSessionId,
    index: 1,
    target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
    presentation: { kind: 'workspace-root' as const },
  }
  const plan = presentationPlanForTest(terminalSessionId, routeTarget)
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
    filesystemTarget: workspaceRootPaneFilesystemTarget({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-1',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: false },
        git: { status: 'unavailable' },
      },
    }),
  } satisfies WorkspacePaneCommandTarget
  rerender({ currentTarget: hydratedTarget })
  await act(async () => await Promise.resolve())

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
  const plan = presentationPlanForTest(terminalSessionId, routeTarget)
  mocks.capturePresentation.mockReturnValue(plan)
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
  const plan = presentationPlanForTest(terminalSessionId, routeTarget)
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
