import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
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

const REPO_RUNTIME_ID = 'repo-runtime-test'
const terminalBase: TerminalSessionBase = {
  repoRoot: 'goblin+file:///repo',
  repoRuntimeId: REPO_RUNTIME_ID,
  branch: 'main',
  worktreePath: '/repo-worktree',
}
const closeTarget = {
  repoRoot: terminalBase.repoRoot,
  repoRuntimeId: REPO_RUNTIME_ID,
  branchName: terminalBase.branch,
  worktreePath: terminalBase.worktreePath,
}

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

  test('rejects confirmed close when terminal base is missing', () => {
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge(terminalCommandBridge({ closeTerminalByDescriptor }))
    const context = readWorkspacePaneRuntimeTabCloseContext()

    expect(
      canCloseWorkspacePaneRuntimeTabWithContext(
        { type: 'terminal', target: { ...closeTarget, worktreePath: null } },
        context,
      ),
    ).toBe(false)
    expect(
      canConfirmWorkspacePaneRuntimeTabCloseWithContext(
        { type: 'terminal', sessionId: 'term-111111111111111111111', target: { ...closeTarget, worktreePath: null } },
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
    terminalWorktreeSnapshot: () => ({
      terminalWorktreeKey: 'repo\0worktree',
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
    closeTerminalByDescriptor,
  }
}
