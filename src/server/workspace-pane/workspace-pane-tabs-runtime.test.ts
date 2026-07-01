import { describe, expect, test } from 'vitest'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'

describe('workspace pane tabs runtime', () => {
  test('replaces mixed tabs within a user branch target', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneTerminalTabEntry('session-1'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-2'),
      ],
    })

    expect(runtime.tabs(target())).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-2'),
    ])
    expect(runtime.terminalSessionIds(worktree())).toEqual(['session-1', 'session-2'])
  })

  test('appends new terminal tabs to the mixed list', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneTerminalTabEntry('session-1'), workspacePaneStaticTabEntry('status')],
    })

    expect(runtime.ensureTerminalTab(target(), 'session-2')).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-2'),
    ])
  })

  test('keeps no-worktree branch targets static-only', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      branchName: 'feature/no-worktree',
      worktreePath: null,
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-1'),
        workspacePaneStaticTabEntry('files'),
      ],
    })

    expect(
      runtime.tabs({
        ...target(),
        branchName: 'feature/no-worktree',
        worktreePath: null,
      }),
    ).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('isolates identical terminal identities by user', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })
    runtime.replaceTabs({
      ...target(),
      userId: 'user-b',
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })

    expect(runtime.terminalSessionIds(worktree())).toEqual(['session-1'])
    expect(runtime.terminalSessionIds({ ...worktree(), userId: 'user-b' })).toEqual(['session-1'])
  })

  test('removes all tabs for a detached user', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })
    runtime.replaceTabs({
      ...target(),
      userId: 'user-b',
      tabs: [workspacePaneTerminalTabEntry('session-1')],
    })

    runtime.closeSessionsForUser('user-a')

    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('status')])
    expect(runtime.terminalSessionIds({ ...worktree(), userId: 'user-b' })).toEqual(['session-1'])
  })
})

function target(): {
  userId: string
  scope: string
  branchName: string
  worktreePath: string
} {
  return {
    userId: 'user-a',
    scope: '/repo',
    branchName: 'feature/worktree',
    worktreePath: '/repo-linked',
  }
}

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
