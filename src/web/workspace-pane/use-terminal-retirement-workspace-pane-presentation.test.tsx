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
      currentTarget: target,
      navigation,
    }),
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')
  const terminalSessionId = 'term-111111111111111111111'
  const tabsBeforeRetirement = [{ type: 'terminal' as const, runtimeSessionId: terminalSessionId }]

  await act(async () => {
    listener({ terminalSessionId, tabsBeforeRetirement })
    await Promise.resolve()
  })

  expect(mocks.runPresentation).toHaveBeenCalledWith({
    target,
    navigation,
    terminalSessionId,
    tabsBeforeRetirement,
  })

  unmount()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

test('ignores an accepted exit without a current command target', () => {
  renderHook(() =>
    useTerminalRetirementWorkspacePanePresentation({
      currentTarget: null,
      navigation: primaryWindowNavigationActionsForTest(),
    }),
  )
  const listener = mocks.listener
  if (!listener) throw new Error('missing accepted-exit listener')

  act(() => {
    listener({
      terminalSessionId: 'term-222222222222222222222',
      tabsBeforeRetirement: [],
    })
  })

  expect(mocks.runPresentation).not.toHaveBeenCalled()
})
