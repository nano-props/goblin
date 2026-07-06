import { describe, expect, test } from 'vitest'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'

describe('workspace pane tabs runtime', () => {
  test('replaces mixed tabs within a user tab target', () => {
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

  test('ensureTerminalTab with insertAfterIdentity inserts after a static anchor', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-1')],
    })

    expect(runtime.ensureTerminalTab(target(), 'session-2', { insertAfterIdentity: 'workspace-pane:status' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-2'),
      workspacePaneTerminalTabEntry('session-1'),
    ])
  })

  test('ensureTerminalTab with insertAfterIdentity inserts after a terminal anchor', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-1')],
    })

    expect(runtime.ensureTerminalTab(target(), 'session-2', { insertAfterIdentity: 'terminal:session-1' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneTerminalTabEntry('session-2'),
    ])
  })

  test('ensureTerminalTab with insertAfterIdentity falls back to append when anchor is missing', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-1')],
    })

    expect(runtime.ensureTerminalTab(target(), 'session-2', { insertAfterIdentity: 'terminal:missing' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneTerminalTabEntry('session-2'),
    ])
  })

  test('opens and closes static tabs in the mixed list', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    expect(runtime.openStaticTab(target(), 'history')).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])
    expect(runtime.openStaticTab(target(), 'history')).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])
    expect(runtime.closeStaticTab(target(), 'status')).toEqual([workspacePaneStaticTabEntry('history')])
  })

  test('openStaticTab with insertAfterIdentity inserts after a static identity', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-1'),
        workspacePaneStaticTabEntry('history'),
      ],
    })

    expect(runtime.openStaticTab(target(), 'changes', { insertAfterIdentity: 'workspace-pane:status' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('changes'),
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('openStaticTab with insertAfterIdentity inserts after a terminal identity', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-1'),
        workspacePaneStaticTabEntry('history'),
      ],
    })

    expect(runtime.openStaticTab(target(), 'changes', { insertAfterIdentity: 'terminal:session-1' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('changes'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('openStaticTab with insertAfterIdentity falls back to append when anchor is not in the strip', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-1')],
    })

    expect(runtime.openStaticTab(target(), 'files', { insertAfterIdentity: 'terminal:missing-session' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('files'),
    ])
  })

  test('reorders only current tab identities and preserves current tabs absent from the drag snapshot', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneTerminalTabEntry('session-1'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
      ],
    })

    expect(
      runtime.reorderTabsByIdentity(target(), [
        'workspace-pane:status',
        'terminal:session-1',
        'workspace-pane:closed-before-reorder',
      ]),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('uses worktree path as the identity for worktree-backed tab lists', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      branchName: 'feature/old',
      tabs: [workspacePaneTerminalTabEntry('session-1'), workspacePaneStaticTabEntry('status')],
    })

    const retargeted = {
      ...target(),
      branchName: 'feature/new',
    }
    expect(runtime.tabs(retargeted)).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
    ])
    expect(runtime.openStaticTab(retargeted, 'history')).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])
    expect(runtime.tabsForScope({ userId: 'user-a', scope: '/repo' })).toEqual([
      {
        branchName: 'feature/new',
        worktreePath: '/repo-linked',
        tabs: [
          workspacePaneTerminalTabEntry('session-1'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
        ],
      },
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
