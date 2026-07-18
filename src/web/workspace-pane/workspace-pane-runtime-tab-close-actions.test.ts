import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTerminalTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import { canonicalWorkspaceLocator, formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  terminalBaseForRuntimeTabCloseTarget,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const REPO_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo' }, 'posix')!
const terminalBase: TerminalSessionBase = {
  target: {
    kind: 'git-worktree' as const,
    workspaceId: REPO_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    root: canonicalWorkspaceLocator('goblin+file:///repo-worktree')!,
  },
  presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
}
const closeTarget = terminalBase

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
      workspacePaneRuntimeTabConfirmedCloseIdentity({
        type: 'terminal',
        sessionId: 'term-111111111111111111111',
        target: closeTarget,
      }),
    ).toBe('terminal:term-111111111111111111111')
  })

  test('uses the canonical terminal base as the runtime close target', () => {
    expect(terminalBaseForRuntimeTabCloseTarget(closeTarget)).toEqual(terminalBase)
  })
})
