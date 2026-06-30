import { describe, expect, test } from 'vitest'
import { createTerminalWorkspaceTabsRuntime } from '#/server/terminal/terminal-workspace-tabs-runtime.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'

describe('terminal workspace tabs runtime', () => {
  test('replaces mixed tabs within a user worktree', () => {
    const runtime = createTerminalWorkspaceTabsRuntime<string>()

    runtime.replaceTabs({
      ...worktree(),
      tabs: [
        workspacePaneTerminalTabEntry('session-1'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-2'),
      ],
    })

    expect(runtime.tabs(worktree())).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-2'),
    ])
    expect(runtime.terminalSessionIds(worktree())).toEqual(['session-1', 'session-2'])
  })

  test('appends new terminal tabs to the mixed list', () => {
    const runtime = createTerminalWorkspaceTabsRuntime<string>()

    runtime.replaceTabs({
      ...worktree(),
      tabs: [workspacePaneTerminalTabEntry('session-1'), workspacePaneStaticTabEntry('status')],
    })

    expect(runtime.ensureTerminalTab(worktree(), 'session-2')).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-2'),
    ])
  })

  test('isolates identical terminal identities by user', () => {
    const runtime = createTerminalWorkspaceTabsRuntime<string>()

    runtime.replaceTabs({
      ...worktree(),
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })
    runtime.replaceTabs({
      ...worktree(),
      userId: 'user-b',
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })

    expect(runtime.terminalSessionIds(worktree())).toEqual(['session-1'])
    expect(runtime.terminalSessionIds({ ...worktree(), userId: 'user-b' })).toEqual(['session-1'])
  })

  test('removes terminal tabs by user', () => {
    const runtime = createTerminalWorkspaceTabsRuntime<string>()

    runtime.replaceTabs({
      ...worktree(),
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })
    runtime.replaceTabs({
      ...worktree(),
      userId: 'user-b',
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })

    runtime.closeSessionsForUser('user-a')

    expect(runtime.tabs(worktree())).toEqual([workspacePaneStaticTabEntry('status')])
    expect(runtime.terminalSessionIds({ ...worktree(), userId: 'user-b' })).toEqual(['session-1'])
  })
})

function worktree(): {
  userId: string
  scope: string
  worktreePath: string
} {
  return {
    userId: 'user-a',
    scope: '/repo',
    worktreePath: '/repo-linked',
  }
}
