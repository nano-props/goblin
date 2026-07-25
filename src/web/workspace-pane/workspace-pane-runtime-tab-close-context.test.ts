import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  createTerminalWithAdmissionForTest,
  setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge,
} from '#/web/test-utils/terminal-session-command-bridge.ts'
import {
  canCloseWorkspacePaneRuntimeTabWithContext,
  canConfirmWorkspacePaneRuntimeTabCloseWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import { terminalRuntimeTabCloseContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const terminalBase: TerminalSessionBase = {
  target: {
    kind: 'git-worktree' as const,
    workspaceId: canonicalWorkspaceLocator('goblin+file:///repo')!,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    root: canonicalWorkspaceLocator('goblin+file:///repo-worktree')!,
  },
  presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
}
const closeTarget = terminalBase

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('workspace pane runtime tab close context', () => {
  test('reads terminal close capability from the command bridge', async () => {
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge(terminalCommandBridge({ closeTerminalByDescriptor }))

    const context = readWorkspacePaneRuntimeTabCloseContext()

    expect(canCloseWorkspacePaneRuntimeTabWithContext({ type: 'terminal', target: closeTarget }, context)).toBe(true)
    expect(
      canConfirmWorkspacePaneRuntimeTabCloseWithContext(
        { type: 'terminal', sessionId: 'term-111111111111111111111', target: closeTarget },
        context,
      ),
    ).toBe(true)
    const terminalContext = terminalRuntimeTabCloseContext(context)
    await expect(
      terminalContext?.closeTerminalByDescriptor?.('term-111111111111111111111', terminalBase),
    ).resolves.toBe(true)
    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', terminalBase)
  })

  test('rejects confirmed close when terminal capability is unavailable', () => {
    const context = readWorkspacePaneRuntimeTabCloseContext()

    expect(terminalRuntimeTabCloseContext(context)).toBeUndefined()
    expect(canCloseWorkspacePaneRuntimeTabWithContext({ type: 'terminal', target: closeTarget }, context)).toBe(false)
    expect(
      canConfirmWorkspacePaneRuntimeTabCloseWithContext(
        { type: 'terminal', sessionId: 'term-111111111111111111111', target: closeTarget },
        context,
      ),
    ).toBe(false)
  })
})

function terminalCommandBridge({
  closeTerminalByDescriptor,
}: {
  closeTerminalByDescriptor: TerminalSessionCommandBridge['closeTerminalByDescriptor']
}): TerminalSessionCommandBridge {
  const createTerminal = vi.fn(async () => 'term-111111111111111111111')
  return {
    terminalFilesystemTargetSnapshot: () => ({
      terminalFilesystemTargetKey: 'repo\0worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }),
    createTerminal,
    createTerminalWithAdmission: createTerminalWithAdmissionForTest(createTerminal),
    selectTerminal: vi.fn(),
    focusTerminal: vi.fn(),
    closeTerminalByDescriptor,
  }
}
