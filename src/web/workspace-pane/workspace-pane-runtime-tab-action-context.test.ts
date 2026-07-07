import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  createWorkspacePaneRuntimeTabActionContext,
  readWorkspacePaneRuntimeTabActionContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-action-context.ts'

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('workspace pane runtime tab action context', () => {
  test('creates runtime action context from explicit terminal capabilities', () => {
    const enterRuntimeTab = vi.fn()
    const selectTerminal = vi.fn()
    const scrollToBottom = vi.fn()

    const context = createWorkspacePaneRuntimeTabActionContext({
      enterRuntimeTab,
      terminal: {
        selectTerminal,
        scrollToBottom,
      },
    })

    context.enterRuntimeTab('terminal')
    context.terminal?.selectTerminal?.('repo\0worktree', 'session-1')
    context.terminal?.scrollToBottom?.('session-1')

    expect(enterRuntimeTab).toHaveBeenCalledWith('terminal')
    expect(selectTerminal).toHaveBeenCalledWith('repo\0worktree', 'session-1')
    expect(scrollToBottom).toHaveBeenCalledWith('session-1')
  })

  test('reads runtime action context from the command bridge', () => {
    const enterRuntimeTab = vi.fn()
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge(terminalCommandBridge({ selectTerminal }))

    const context = readWorkspacePaneRuntimeTabActionContext({ enterRuntimeTab })

    context.enterRuntimeTab('terminal')
    context.terminal?.selectTerminal?.('repo\0worktree', 'session-1')

    expect(enterRuntimeTab).toHaveBeenCalledWith('terminal')
    expect(selectTerminal).toHaveBeenCalledWith('repo\0worktree', 'session-1')
  })

  test('omits terminal runtime actions when the command bridge is unavailable', () => {
    const context = readWorkspacePaneRuntimeTabActionContext({ enterRuntimeTab: vi.fn() })

    expect(context.terminal).toBeUndefined()
  })
})

function terminalCommandBridge({
  selectTerminal,
}: {
  selectTerminal: TerminalSessionCommandBridge['selectTerminal']
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
    selectTerminal,
  }
}
