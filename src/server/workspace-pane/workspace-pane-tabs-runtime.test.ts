import { describe, expect, test } from 'vitest'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'

describe('workspace pane tabs runtime', () => {
  test('replaces mixed tabs within a user tab target', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
      ],
    })

    expect(runtime.tabs(target())).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
    ])
    expect(runtime.runtimeSessionIds(worktree(), 'terminal')).toEqual(['term-111111111111111111111', 'term-222222222222222222222'])
  })

  test('appends new runtime tabs to the mixed list', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'), workspacePaneStaticTabEntry('status')],
    })

    expect(runtime.ensureRuntimeTab(target(), 'terminal', 'term-222222222222222222222')).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
    ])
  })

  test('ensureRuntimeTab with insertAfterIdentity inserts after a static anchor', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })

    expect(
      runtime.ensureRuntimeTab(target(), 'terminal', 'term-222222222222222222222', { insertAfterIdentity: 'workspace-pane:status' }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
    ])
  })

  test('ensureRuntimeTab with insertAfterIdentity inserts after a runtime anchor', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })

    expect(
      runtime.ensureRuntimeTab(target(), 'terminal', 'term-222222222222222222222', { insertAfterIdentity: 'terminal:term-111111111111111111111' }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
    ])
  })

  test('ensureRuntimeTab with insertAfterIdentity moves an existing runtime tab after the anchor', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
        workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
      ],
    })

    expect(
      runtime.ensureRuntimeTab(target(), 'terminal', 'term-222222222222222222222', {
        insertAfterIdentity: 'workspace-pane:status',
      }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('ensureRuntimeTab without insertAfterIdentity preserves an existing runtime tab order', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
        workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
      ],
    })

    expect(runtime.ensureRuntimeTab(target(), 'terminal', 'term-222222222222222222222')).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
    ])
  })

  test('ensureRuntimeTab with insertAfterIdentity falls back to append when anchor is missing', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })

    expect(
      runtime.ensureRuntimeTab(target(), 'terminal', 'term-222222222222222222222', { insertAfterIdentity: 'terminal:missing' }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
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

  test('allows closing the final tab', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    expect(runtime.closeStaticTab(target(), 'status')).toEqual([])
    expect(runtime.tabs(target())).toEqual([])
  })

  test('openStaticTab with insertAfterIdentity inserts after a static identity', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('history'),
      ],
    })

    expect(runtime.openStaticTab(target(), 'changes', { insertAfterIdentity: 'workspace-pane:status' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('changes'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('openStaticTab with insertAfterIdentity inserts after a terminal identity', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('history'),
      ],
    })

    expect(runtime.openStaticTab(target(), 'changes', { insertAfterIdentity: 'terminal:term-111111111111111111111' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('changes'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('openStaticTab with insertAfterIdentity falls back to append when anchor is not in the strip', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })

    expect(runtime.openStaticTab(target(), 'files', { insertAfterIdentity: 'terminal:missing-session' })).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('files'),
    ])
  })

  test('reorders only current tab identities and preserves current tabs absent from the drag snapshot', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({
      ...target(),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
      ],
    })

    expect(
      runtime.reorderTabsByIdentity(target(), [
        'workspace-pane:status',
        'terminal:term-111111111111111111111',
        'workspace-pane:closed-before-reorder',
      ]),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('uses worktree path as the identity for worktree-backed tab lists', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      branchName: 'feature/old',
      tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'), workspacePaneStaticTabEntry('status')],
    })

    const retargeted = {
      ...target(),
      branchName: 'feature/new',
    }
    expect(runtime.tabs(retargeted)).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
    ])
    expect(runtime.openStaticTab(retargeted, 'history')).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])
    expect(runtime.tabsForScope({ userId: 'user-a', scope: '/repo' })).toEqual([
      {
        branchName: 'feature/new',
        worktreePath: '/repo-linked',
        tabs: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
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
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
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
      tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })
    runtime.replaceTabs({
      ...target(),
      userId: 'user-b',
      tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })

    expect(runtime.runtimeSessionIds(worktree(), 'terminal')).toEqual(['term-111111111111111111111'])
    expect(runtime.runtimeSessionIds({ ...worktree(), userId: 'user-b' }, 'terminal')).toEqual(['term-111111111111111111111'])
  })

  test('removes all tabs for a detached user', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })
    runtime.replaceTabs({
      ...target(),
      userId: 'user-b',
      tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
    })

    runtime.closeTabsForUser('user-a')

    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('status')])
    expect(runtime.runtimeSessionIds({ ...worktree(), userId: 'user-b' }, 'terminal')).toEqual(['term-111111111111111111111'])
  })

  test('lists scopes owned by a user', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()

    runtime.replaceTabs({
      ...target(),
      scope: 'scope-a',
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    runtime.replaceTabs({
      ...target(),
      scope: 'scope-b',
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    runtime.replaceTabs({
      ...target(),
      userId: 'user-b',
      scope: 'scope-c',
      tabs: [workspacePaneStaticTabEntry('files')],
    })

    expect(runtime.scopesForUser('user-a').sort()).toEqual(['scope-a', 'scope-b'])
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
