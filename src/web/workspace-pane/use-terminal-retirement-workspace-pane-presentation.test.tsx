// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AcceptedTerminalRetirement } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { primaryWindowNavigationActionsForTest } from '#/web/test-utils/primary-window-navigation.ts'

const mocks = vi.hoisted(() => ({
  listener: null as ((retirement: AcceptedTerminalRetirement) => void) | null,
  unsubscribe: vi.fn(),
  runPresentation: vi.fn(async () => true),
}))

vi.mock('#/web/components/terminal/use-terminal-session-projection.ts', () => ({
  useTerminalSessionProjection: () => ({
    subscribeAcceptedRetirement(listener: (retirement: AcceptedTerminalRetirement) => void) {
      mocks.listener = listener
      return mocks.unsubscribe
    },
  }),
}))

vi.mock('#/web/commands/workspace-commands.ts', () => ({
  runRetiredTerminalWorkspacePaneTabPresentationCommand: mocks.runPresentation,
}))

import { useTerminalRetirementWorkspacePanePresentation } from '#/web/workspace-pane/use-terminal-retirement-workspace-pane-presentation.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-exit-presentation-workspace')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-exit-presentation-other')

beforeEach(() => {
  mocks.listener = null
  mocks.unsubscribe.mockReset()
  mocks.runPresentation.mockReset()
  mocks.runPresentation.mockResolvedValue(true)
})

test('routes an accepted current-workspace exit into the presentation command and unsubscribes', async () => {
  const navigation = primaryWindowNavigationActionsForTest()
  const target = {
    routeTarget: {
      kind: 'git-branch' as const,
      workspaceId: WORKSPACE_ID,
      branchName: 'feature/terminal-exit',
    },
    workspacePaneRoute: { kind: 'terminal' as const, terminalSessionId: 'term-111111111111111111111' },
    filesystemTarget: null,
  }
  const { unmount } = renderHook(() =>
    useTerminalRetirementWorkspacePanePresentation({
      currentWorkspaceId: WORKSPACE_ID,
      currentTarget: target,
      navigation,
    }),
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')
  const descriptor = {
    terminalSessionId: 'term-111111111111111111111',
    index: 1,
    target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-1' },
    presentation: { kind: 'workspace-root' as const },
  }
  const retirementPresentation = {
    target: descriptor.target,
    terminalBase: { target: descriptor.target, presentation: descriptor.presentation },
    tabsBeforeRetirement: [{ type: 'terminal' as const, runtimeSessionId: descriptor.terminalSessionId }],
  }

  await act(async () => {
    listener({ terminalSessionId: descriptor.terminalSessionId, retirementPresentation })
    await Promise.resolve()
  })

  expect(mocks.runPresentation).toHaveBeenCalledWith({
    workspaceId: WORKSPACE_ID,
    target,
    navigation,
    terminalSessionId: descriptor.terminalSessionId,
    retirementPresentation,
  })

  unmount()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

test('ignores an accepted exit from a background workspace', () => {
  renderHook(() =>
    useTerminalRetirementWorkspacePanePresentation({
      currentWorkspaceId: WORKSPACE_ID,
      currentTarget: null,
      navigation: primaryWindowNavigationActionsForTest(),
    }),
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')

  act(() => {
    listener({
      terminalSessionId: 'term-222222222222222222222',
      retirementPresentation: {
        target: { kind: 'workspace-root', workspaceId: OTHER_WORKSPACE_ID, workspaceRuntimeId: 'runtime-2' },
        terminalBase: {
          target: { kind: 'workspace-root', workspaceId: OTHER_WORKSPACE_ID, workspaceRuntimeId: 'runtime-2' },
          presentation: { kind: 'workspace-root' },
        },
        tabsBeforeRetirement: [],
      },
    })
  })

  expect(mocks.runPresentation).not.toHaveBeenCalled()
})
