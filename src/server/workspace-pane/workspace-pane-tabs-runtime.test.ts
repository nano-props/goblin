import { describe, expect, test } from 'vitest'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

describe('workspace pane tabs runtime storage', () => {
  test('stores mixed tabs and projects terminal session order', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
    ]

    runtime.replaceTabs({ ...target(), tabs })

    expect(runtime.tabs(target())).toEqual(tabs)
    expect(runtime.runtimeSessionIds(worktree(), 'terminal')).toEqual([
      'term-111111111111111111111',
      'term-222222222222222222222',
    ])
  })

  test('uses worktree path as the identity and updates branch metadata on replace', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
    ]
    runtime.replaceTabs({ ...target(), branchName: 'feature/old', tabs })

    const retargeted = { ...target(), branchName: 'feature/new' }
    runtime.replaceTabs({ ...retargeted, tabs })

    expect(runtime.tabs(retargeted)).toEqual(tabs)
    expect(runtime.tabsForScope({ userId: 'user-a', scope: '/repo' })).toEqual([
      { branchName: 'feature/new', worktreePath: '/repo-linked', tabs },
    ])
  })

  test('removes runtime and worktree-only tabs from no-worktree targets', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const noWorktree = { ...target(), branchName: 'feature/no-worktree', worktreePath: null }

    runtime.replaceTabs({
      ...noWorktree,
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('files'),
      ],
    })

    expect(runtime.tabs(noWorktree)).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('isolates identical terminal identities by user', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')]
    runtime.replaceTabs({ ...target(), tabs })
    runtime.replaceTabs({ ...target(), userId: 'user-b', tabs })

    expect(runtime.runtimeSessionIds(worktree(), 'terminal')).toEqual(['term-111111111111111111111'])
    expect(runtime.runtimeSessionIds({ ...worktree(), userId: 'user-b' }, 'terminal')).toEqual([
      'term-111111111111111111111',
    ])
  })

  test('closes user and scope storage without affecting other owners', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')]
    runtime.replaceTabs({ ...target(), tabs })
    runtime.replaceTabs({ ...target(), userId: 'user-b', tabs })
    runtime.replaceTabs({ ...target(), scope: 'scope-b', tabs: [workspacePaneStaticTabEntry('history')] })

    runtime.closeTabsForScope('user-a', 'scope-b')
    expect(runtime.scopesForUser('user-a')).toEqual(['/repo'])

    runtime.closeTabsForUser('user-a')
    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('status')])
    expect(runtime.runtimeSessionIds({ ...worktree(), userId: 'user-b' }, 'terminal')).toEqual([
      'term-111111111111111111111',
    ])
  })

  test('enumerates every user and runtime scope for one physical worktree', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [workspacePaneStaticTabEntry('status')]
    runtime.replaceTabs({ ...target(), scope: '/repo\0runtime-a', tabs })
    runtime.replaceTabs({ ...target(), userId: 'user-b', scope: '/repo\0runtime-b', tabs })
    runtime.replaceTabs({ ...target(), scope: '/other-repo\0runtime-c', tabs })

    expect(runtime.physicalWorktreeScopes({ repoRoot: '/repo', worktreePath: '/repo-linked' })).toEqual([
      { userId: 'user-a', scope: '/repo\0runtime-a' },
      { userId: 'user-b', scope: '/repo\0runtime-b' },
    ])
  })

  test('advances revisions monotonically per user and scope only when canonical state changes', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [workspacePaneStaticTabEntry('status')]

    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(0)
    runtime.replaceTabs({ ...target(), tabs })
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(1)

    runtime.replaceTabs({ ...target(), tabs })
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(1)

    runtime.replaceTabs({ ...target(), userId: 'user-b', tabs })
    expect(runtime.revision({ userId: 'user-b', scope: '/repo' })).toBe(1)
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(1)

    runtime.closeTabsForScope('user-a', '/repo')
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(2)
    runtime.closeTabsForScope('user-a', '/repo')
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(2)
  })

  test('closes every target for one worktree with one revision without affecting sibling worktrees', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    runtime.replaceTabs({ ...target(), tabs: [workspacePaneStaticTabEntry('status')] })
    runtime.replaceTabs({
      ...target(),
      branchName: 'feature/renamed',
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    runtime.replaceTabs({
      ...target(),
      branchName: 'feature/other',
      worktreePath: '/repo-other',
      tabs: [workspacePaneStaticTabEntry('files')],
    })
    const revision = runtime.revision({ userId: 'user-a', scope: '/repo' })

    runtime.closeTabsForWorktree(worktree())

    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(revision + 1)
    expect(runtime.tabsForScope({ userId: 'user-a', scope: '/repo' })).toEqual([
      {
        branchName: 'feature/other',
        worktreePath: '/repo-other',
        tabs: [workspacePaneStaticTabEntry('files')],
      },
    ])
  })
})

function target(): { userId: string; scope: string; branchName: string; worktreePath: string } {
  return {
    userId: 'user-a',
    scope: '/repo',
    branchName: 'feature/worktree',
    worktreePath: '/repo-linked',
  }
}

function worktree(): { userId: string; scope: string; worktreePath: string } {
  return {
    userId: 'user-a',
    scope: '/repo',
    worktreePath: '/repo-linked',
  }
}
