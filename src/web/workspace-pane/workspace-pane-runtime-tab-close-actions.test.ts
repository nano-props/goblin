import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTerminalTabSummary } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseBranchName,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

const terminalBase: TerminalSessionBase = {
  repoRoot: '/repo',
  branch: 'main',
  worktreePath: '/repo-worktree',
}

const terminalView: WorkspacePaneTerminalTabSummary = {
  type: 'terminal',
  terminalSessionId: 'session-1',
  terminalWorktreeKey: 'repo\0worktree',
  index: 1,
  title: 'Terminal 1',
  fullTitle: 'Terminal 1',
  originalTitle: null,
  phase: 'open',
  processName: 'node',
  selected: true,
  hasBell: false,
  hasRecentOutput: false,
}

describe('workspace pane runtime tab close actions', () => {
  test('requests close confirmation for terminal tabs running non-shell processes', () => {
    expect(
      workspacePaneRuntimeTabCloseConfirmRequest({
        type: 'terminal',
        identity: 'terminal:session-1',
        sessionId: 'session-1',
        view: terminalView,
        terminalBase,
      }),
    ).toEqual({
      type: 'terminal',
      identity: 'terminal:session-1',
      sessionId: 'session-1',
      terminalBase,
      processName: 'node',
    })
  })

  test('does not request close confirmation for terminal tabs running a shell', () => {
    expect(
      workspacePaneRuntimeTabCloseConfirmRequest({
        type: 'terminal',
        identity: 'terminal:session-1',
        sessionId: 'session-1',
        view: { ...terminalView, processName: 'zsh' },
        terminalBase,
      }),
    ).toBeNull()
  })

  test('confirms terminal runtime close through the runtime close registry', async () => {
    const closeTerminalByDescriptor = vi.fn(async () => true)

    await expect(
      confirmWorkspacePaneRuntimeTabClose(
        { type: 'terminal', sessionId: 'session-1', terminalBase },
        { terminal: { closeTerminalByDescriptor } },
      ),
    ).resolves.toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', terminalBase)
    expect(
      workspacePaneRuntimeTabConfirmedCloseBranchName({ type: 'terminal', sessionId: 'session-1', terminalBase }),
    ).toBe('main')
    expect(workspacePaneRuntimeTabConfirmedCloseIdentity({ type: 'terminal', sessionId: 'session-1' })).toBe(
      'terminal:session-1',
    )
  })
})
