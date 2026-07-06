import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  canCloseWorkspacePaneRuntimeTabWithContext,
  canConfirmWorkspacePaneRuntimeTabCloseWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'

const terminalBase: TerminalSessionBase = {
  repoRoot: '/repo',
  branch: 'main',
  worktreePath: '/repo-worktree',
}

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('workspace pane runtime tab close context', () => {
  test('reads terminal close capability from the command bridge', async () => {
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeTerminalsForWorktree = vi.fn(async () => true)
    setTerminalSessionCommandBridge(terminalCommandBridge({ closeTerminalByDescriptor, closeTerminalsForWorktree }))

    const context = readWorkspacePaneRuntimeTabCloseContext()

    expect(
      canCloseWorkspacePaneRuntimeTabWithContext(
        { type: 'terminal', terminalBase },
        context,
      ),
    ).toBe(true)
    expect(
      canConfirmWorkspacePaneRuntimeTabCloseWithContext(
        { type: 'terminal', sessionId: 'session-1', terminalBase },
        context,
      ),
    ).toBe(true)
    await expect(context.terminal?.closeTerminalByDescriptor?.('session-1', terminalBase)).resolves.toBe(true)
    await expect(context.terminal?.closeTerminalsForWorktree?.(terminalBase)).resolves.toBe(true)
    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', terminalBase)
    expect(closeTerminalsForWorktree).toHaveBeenCalledWith(terminalBase)
  })

  test('rejects confirmed close when terminal capability is unavailable', () => {
    const context = readWorkspacePaneRuntimeTabCloseContext()

    expect(context.terminal).toBeUndefined()
    expect(canCloseWorkspacePaneRuntimeTabWithContext({ type: 'terminal', terminalBase }, context)).toBe(false)
    expect(
      canConfirmWorkspacePaneRuntimeTabCloseWithContext(
        { type: 'terminal', sessionId: 'session-1', terminalBase },
        context,
      ),
    ).toBe(false)
  })

  test('rejects confirmed close when terminal base is missing', () => {
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge(terminalCommandBridge({ closeTerminalByDescriptor }))
    const context = readWorkspacePaneRuntimeTabCloseContext()

    expect(canCloseWorkspacePaneRuntimeTabWithContext({ type: 'terminal' }, context)).toBe(false)
    expect(canConfirmWorkspacePaneRuntimeTabCloseWithContext({ type: 'terminal', sessionId: 'session-1' }, context))
      .toBe(false)
  })
})

function terminalCommandBridge({
  closeTerminalByDescriptor,
  closeTerminalsForWorktree,
}: {
  closeTerminalByDescriptor: TerminalSessionCommandBridge['closeTerminalByDescriptor']
  closeTerminalsForWorktree?: TerminalSessionCommandBridge['closeTerminalsForWorktree']
}): TerminalSessionCommandBridge {
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
    createTerminal: vi.fn(async () => 'session-1'),
    selectTerminal: vi.fn(),
    closeTerminalByDescriptor,
    closeTerminalsForWorktree,
  }
}
