import { describe, expect, test } from 'vitest'
import {
  createWorkspacePaneTabsRuntime,
  type WorkspacePaneTabsRuntime,
} from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { testPhysicalWorktreeIdentity } from '#/server/test-utils/physical-worktree-identity.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

describe('workspace pane tabs runtime storage', () => {
  test('keeps mutation plans side-effect free until commit', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const plan = runtime.planReplace({ ...target(), tabs: [workspacePaneStaticTabEntry('history')] })

    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('status')])
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(0)

    runtime.commitPlan(plan)
    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('history')])
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(1)
  })

  test('plans update operations inside the aggregate', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const terminal = workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')
    commitReplace(runtime, { ...target(), tabs: [workspacePaneStaticTabEntry('status')] })

    const plan = runtime.planUpdate({
      ...target(),
      currentTabs: [workspacePaneStaticTabEntry('status'), terminal],
      operation: { type: 'open-static', tabType: 'history' },
    })

    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('status')])
    expect(runtime.scopeEntriesForPlan(plan)).toEqual([
      {
        repoRoot: '/repo',
        branchName: 'feature/worktree',
        worktreePath: '/repo-linked',
        tabs: [workspacePaneStaticTabEntry('status'), terminal, workspacePaneStaticTabEntry('history')],
      },
    ])

    runtime.commitPlan(plan)
    expect(runtime.tabs(target())).toEqual([
      workspacePaneStaticTabEntry('status'),
      terminal,
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('rejects a plan built from an older aggregate revision', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const stalePlan = runtime.planReplace({ ...target(), tabs: [workspacePaneStaticTabEntry('history')] })
    commitReplace(runtime, { ...target(), tabs: [workspacePaneStaticTabEntry('changes')] })

    expect(() => runtime.commitPlan(stalePlan)).toThrow('error.workspace-tabs-plan-stale')
    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('changes')])
  })

  test('rejects a mutation whose repo root does not own the scope', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    commitReplace(runtime, { ...target(), tabs: [workspacePaneStaticTabEntry('status')] })

    expect(() =>
      runtime.planRetire({
        userId: 'user-a',
        scope: '/repo',
        target: { kind: 'worktree', repoRoot: '/other-repo', worktreePath: '/repo-linked' },
      }),
    ).toThrow('error.workspace-tabs-scope-repo-mismatch')
  })

  test('tracks initialized scope lifecycle independently from stored entries', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const scope = { userId: 'user-a', scope: '/repo' }

    expect(runtime.isScopeInitialized(scope)).toBe(false)
    runtime.initializeScope(scope)
    expect(runtime.isScopeInitialized(scope)).toBe(true)
    expect(runtime.scopesForUser(scope.userId)).toEqual([scope.scope])
    runtime.closeTabsForScope(scope.userId, scope.scope)
    expect(runtime.isScopeInitialized(scope)).toBe(false)
  })

  test('stores mixed tabs and projects terminal session order', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
    ]

    commitReplace(runtime, { ...target(), tabs })

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
    commitReplace(runtime, { ...target(), branchName: 'feature/old', tabs })

    const retargeted = { ...target(), branchName: 'feature/new' }
    commitReplace(runtime, { ...retargeted, tabs })

    expect(runtime.tabs(retargeted)).toEqual(tabs)
    expect(runtime.tabsForScope({ userId: 'user-a', scope: '/repo' })).toEqual([
      { branchName: 'feature/new', worktreePath: '/repo-linked', tabs },
    ])
  })

  test('removes runtime and worktree-only tabs from no-worktree targets', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const noWorktree = {
      ...target(),
      branchName: 'feature/no-worktree',
      worktreePath: null,
      physicalWorktreeIdentity: null,
    }

    commitReplace(runtime, {
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
    commitReplace(runtime, { ...target(), tabs })
    commitReplace(runtime, { ...target(), userId: 'user-b', tabs })

    expect(runtime.runtimeSessionIds(worktree(), 'terminal')).toEqual(['term-111111111111111111111'])
    expect(runtime.runtimeSessionIds({ ...worktree(), userId: 'user-b' }, 'terminal')).toEqual([
      'term-111111111111111111111',
    ])
  })

  test('closes user and scope storage without affecting other owners', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')]
    commitReplace(runtime, { ...target(), tabs })
    commitReplace(runtime, { ...target(), userId: 'user-b', tabs })
    commitReplace(runtime, { ...target(), scope: 'scope-b', tabs: [workspacePaneStaticTabEntry('history')] })

    runtime.closeTabsForScope('user-a', 'scope-b')
    expect(runtime.scopesForUser('user-a')).toEqual(['/repo'])
    expect(runtime.revision({ userId: 'user-a', scope: 'scope-b' })).toBe(2)

    runtime.closeTabsForUser('user-a')
    expect(runtime.tabs(target())).toEqual([workspacePaneStaticTabEntry('status')])
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(2)
    expect(runtime.runtimeSessionIds({ ...worktree(), userId: 'user-b' }, 'terminal')).toEqual([
      'term-111111111111111111111',
    ])
  })

  test('enumerates every user and runtime scope across repository entries for one physical worktree', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [workspacePaneStaticTabEntry('status')]
    commitReplace(runtime, { ...target(), scope: '/repo\0runtime-a', tabs })
    commitReplace(runtime, { ...target(), userId: 'user-b', scope: '/repo\0runtime-b', tabs })
    commitReplace(runtime, { ...target(), repoRoot: '/other-repo', scope: '/other-repo\0runtime-c', tabs })

    expect(runtime.physicalWorktreeTargets(testPhysicalWorktreeIdentity('/repo-linked'))).toEqual([
      {
        userId: 'user-a',
        scope: '/repo\0runtime-a',
        target: { kind: 'worktree', repoRoot: '/repo', worktreePath: '/repo-linked' },
      },
      {
        userId: 'user-b',
        scope: '/repo\0runtime-b',
        target: { kind: 'worktree', repoRoot: '/repo', worktreePath: '/repo-linked' },
      },
      {
        userId: 'user-a',
        scope: '/other-repo\0runtime-c',
        target: { kind: 'worktree', repoRoot: '/other-repo', worktreePath: '/repo-linked' },
      },
    ])
  })

  test('advances revisions monotonically per user and scope only when canonical state changes', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    const tabs = [workspacePaneStaticTabEntry('status')]

    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(0)
    commitReplace(runtime, { ...target(), tabs })
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(1)

    commitReplace(runtime, { ...target(), tabs })
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(1)

    commitReplace(runtime, { ...target(), userId: 'user-b', tabs })
    expect(runtime.revision({ userId: 'user-b', scope: '/repo' })).toBe(1)
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(1)

    runtime.closeTabsForScope('user-a', '/repo')
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(2)
    runtime.closeTabsForScope('user-a', '/repo')
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(2)
    runtime.releaseRevisionForScope('user-a', '/repo')
    expect(runtime.revision({ userId: 'user-a', scope: '/repo' })).toBe(0)
  })

  test('does not release a repo-runtime epoch clock while its targets are live', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    commitReplace(runtime, { ...target(), tabs: [workspacePaneStaticTabEntry('status')] })

    expect(() => runtime.releaseRevisionForScope('user-a', '/repo')).toThrow(
      'cannot release workspace pane tabs revision with live targets',
    )
  })

  test('closes every target for one worktree with one revision without affecting sibling worktrees', () => {
    const runtime = createWorkspacePaneTabsRuntime<string>()
    commitReplace(runtime, { ...target(), tabs: [workspacePaneStaticTabEntry('status')] })
    commitReplace(runtime, {
      ...target(),
      branchName: 'feature/renamed',
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    commitReplace(runtime, {
      ...target(),
      branchName: 'feature/other',
      worktreePath: '/repo-other',
      physicalWorktreeIdentity: testPhysicalWorktreeIdentity('/repo-other'),
      tabs: [workspacePaneStaticTabEntry('files')],
    })
    const revision = runtime.revision({ userId: 'user-a', scope: '/repo' })

    const plan = runtime.planRetire({
      userId: 'user-a',
      scope: '/repo',
      target: { kind: 'worktree', repoRoot: '/repo', worktreePath: '/repo-linked' },
    })
    runtime.commitPlan(plan)

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

function target() {
  return {
    userId: 'user-a',
    repoRoot: '/repo',
    scope: '/repo',
    branchName: 'feature/worktree',
    worktreePath: '/repo-linked',
    physicalWorktreeIdentity: testPhysicalWorktreeIdentity('/repo-linked'),
  }
}

function commitReplace(
  runtime: WorkspacePaneTabsRuntime<string>,
  input: Parameters<typeof runtime.planReplace>[0],
): void {
  runtime.commitPlan(runtime.planReplace(input))
}

function worktree() {
  return {
    userId: 'user-a',
    scope: '/repo',
    worktreePath: '/repo-linked',
    identity: testPhysicalWorktreeIdentity('/repo-linked'),
  }
}
