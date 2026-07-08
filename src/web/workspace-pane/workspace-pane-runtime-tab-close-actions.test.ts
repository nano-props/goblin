import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTerminalTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  closeWorkspacePaneRuntimeTabsForWorktree,
  confirmWorkspacePaneRuntimeTabClose,
  terminalBaseForRuntimeTabCloseTarget,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseBranchName,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

const REPO_INSTANCE_ID = 'repo-instance-test'
const terminalBase: TerminalSessionBase = {
  repoRoot: '/repo',
  repoInstanceId: REPO_INSTANCE_ID,
  branch: 'main',
  worktreePath: '/repo-worktree',
}
const closeTarget = {
  repoRoot: terminalBase.repoRoot,
  repoInstanceId: REPO_INSTANCE_ID,
  branchName: terminalBase.branch,
  worktreePath: terminalBase.worktreePath,
}

const terminalView: WorkspacePaneTerminalTabSummary = {
  type: 'terminal',
  terminalSessionId: 'term-111111111111111111111',
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
        identity: 'terminal:term-111111111111111111111',
        sessionId: 'term-111111111111111111111',
        view: terminalView,
        target: closeTarget,
      }),
    ).toEqual({
      type: 'terminal',
      identity: 'terminal:term-111111111111111111111',
      sessionId: 'term-111111111111111111111',
      target: closeTarget,
      processName: 'node',
    })
  })

  test('does not request close confirmation for terminal tabs running a shell', () => {
    expect(
      workspacePaneRuntimeTabCloseConfirmRequest({
        type: 'terminal',
        identity: 'terminal:term-111111111111111111111',
        sessionId: 'term-111111111111111111111',
        view: { ...terminalView, processName: 'zsh' },
        target: closeTarget,
      }),
    ).toBeNull()
  })

  test('confirms terminal runtime close through the runtime close registry', async () => {
    const closeTerminalByDescriptor = vi.fn(async () => true)

    await expect(
      confirmWorkspacePaneRuntimeTabClose(
        { type: 'terminal', sessionId: 'term-111111111111111111111', target: closeTarget },
        { byType: { terminal: { closeTerminalByDescriptor } } },
      ),
    ).resolves.toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', terminalBase)
    expect(
      workspacePaneRuntimeTabConfirmedCloseBranchName({
        type: 'terminal',
        sessionId: 'term-111111111111111111111',
        target: closeTarget,
      }),
    ).toBe('main')
    expect(
      workspacePaneRuntimeTabConfirmedCloseIdentity({ type: 'terminal', sessionId: 'term-111111111111111111111', target: closeTarget }),
    ).toBe('terminal:term-111111111111111111111')
  })

  test('closes terminal worktree sessions through the runtime close registry', async () => {
    const closeTerminalsForWorktree = vi.fn(async () => true)

    await expect(
      closeWorkspacePaneRuntimeTabsForWorktree('terminal', closeTarget, {
        byType: { terminal: { closeTerminalsForWorktree } },
      }),
    ).resolves.toBe(true)

    expect(closeTerminalsForWorktree).toHaveBeenCalledWith(terminalBase)
  })

  test('builds terminal bases from runtime close targets', () => {
    expect(terminalBaseForRuntimeTabCloseTarget(closeTarget)).toEqual(terminalBase)
    expect(terminalBaseForRuntimeTabCloseTarget({ ...closeTarget, worktreePath: null })).toBeNull()
  })
})
