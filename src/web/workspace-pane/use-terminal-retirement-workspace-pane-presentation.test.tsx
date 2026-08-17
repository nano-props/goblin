// @vitest-environment jsdom

import {
  workspacePaneLocationForBranchTarget,
  workspacePaneLocationForLinkedWorktree,
  workspacePaneLocationForRoot,
} from '#/web/workspace-pane/workspace-pane-location.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AcceptedTerminalRetirement } from '#/web/terminal/components/TerminalSessionProjection.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

const mocks = vi.hoisted(() => ({
  listener: null as ((retirement: AcceptedTerminalRetirement) => void) | null,
  unsubscribe: vi.fn(),
  runPresentation: vi.fn(async () => true),
}))

vi.mock('#/web/terminal/components/use-terminal-session-projection.ts', () => ({
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

describe('terminal retirement workspace pane presentation', () => {
  beforeEach(() => {
    mocks.listener = null
    mocks.unsubscribe.mockReset()
    mocks.runPresentation.mockReset()
    mocks.runPresentation.mockResolvedValue(true)
  })

  test('routes an accepted current-workspace exit into the presentation command and unsubscribes', async () => {
    const navigation = appNavigationActionsForTest()
    const target = {
      location: workspacePaneLocationForRoot(WORKSPACE_ID, 'workspace_runtime_terminal_exit'),
      workspacePaneRoute: { kind: 'terminal' as const, terminalSessionId: 'term-111111111111111111111' },
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      } as const,
    }
    const { unmount } = renderComposableInJsdom(() =>
      useTerminalRetirementWorkspacePanePresentation({
        currentTarget: target,
        navigation,
      }),
    )
    const listener = mocks.listener
    if (!listener) throw new Error('missing accepted-exit listener')
    const terminalSessionId = 'term-111111111111111111111'
    const tabsBeforeRetirement = [{ type: 'terminal' as const, runtimeSessionId: terminalSessionId }]

    await flushTestUpdates(async () => {
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

  test('ignores an accepted exit without a current command target', async () => {
    renderComposableInJsdom(() =>
      useTerminalRetirementWorkspacePanePresentation({
        currentTarget: null,
        navigation: appNavigationActionsForTest(),
      }),
    )
    const listener = mocks.listener
    if (!listener) throw new Error('missing accepted-exit listener')

    await flushTestUpdates(() => {
      listener({
        terminalSessionId: 'term-222222222222222222222',
        tabsBeforeRetirement: [],
      })
    })

    expect(mocks.runPresentation).not.toHaveBeenCalled()
  })
})
