import { beforeEach, describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoreRestorableWorkspaceStateFromSession,
  workspaceSessionStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

describe('restorable-workspace-state', () => {
  beforeEach(() => {
    resetReposStore()
  })

  test('maps restorable workspace state into WorkspaceSessionState', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            '/tmp/repo\0/tmp/worktree': 'session-2',
          },
        },
      }),
    ).toEqual({
      openRepoEntries: [localRepoSessionEntry('/tmp/repo')],
      activeRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/worktree': 'session-2',
      },
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: 'terminal' } },
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': { [targetKey]: [workspacePaneStaticTabEntry('status')] },
      },
      filetreeViewStateByWorktreeByRepo: {},
    })
  })

  test('fails session persistence when an open repo has no branch read model', () => {
    const repo = emptyRepo('/tmp/repo-without-query-model', 'repo-without-query-model', 'repo-instance-without-query')

    expect(() =>
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toThrow('repo branch read model query data unavailable for repo: /tmp/repo-without-query-model')
  })

  test('persists changes as a session-restorable preferred tab when its static tab is open', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: 'changes' } },
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
        },
      },
    })
  })

  test('does not persist a branch preferred tab whose tab is closed', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': { [targetKey]: [workspacePaneStaticTabEntry('status')] },
      },
    })
  })

  test('restores restorable workspace state from WorkspaceSessionState', () => {
    const targetKey = branchTargetKey('/tmp/repo', 'main')
    expect(
      restoreRestorableWorkspaceStateFromSession({
        openRepoEntries: [localRepoSessionEntry('/tmp/repo')],
        activeRepoId: '/tmp/repo',
        zenMode: false,
        workspacePaneSize: 40,
        selectedTerminalSessionIdByTerminalWorktree: {
          '/tmp/repo\0/tmp/worktree': 'session-1',
        },
        preferredWorkspacePaneTabByTargetByRepo: {},
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: [],
          },
        },
        filetreeViewStateByWorktreeByRepo: {},
      }),
    ).toEqual({
      activeId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 40,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/worktree': 'session-1',
      },
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [],
        },
      },
    })
  })

  test('persists files as a session-restorable preferred tab when its static tab is open', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: 'files' } },
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
        },
      },
    })
  })

  test('round-trips a files tab through session-restore', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    const sessionState = workspaceSessionStateFromRestorableWorkspaceState({
      repos: { [repo.id]: repo },
      restorableWorkspaceState: {
        order: [repo.id],
        activeId: repo.id,
        zenMode: false,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
      },
    })
    const restored = restoreRestorableWorkspaceStateFromSession(sessionState)
    expect(restored.workspacePaneTabsByTargetByRepo).toEqual({
      '/tmp/repo': {
        [targetKey]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    expect(restored.preferredWorkspacePaneTabByTargetByRepo).toEqual({
      '/tmp/repo': { [targetKey]: 'files' },
    })
  })

  test('persists file tree view state into session state', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
        filetreeInteractionByScope: {
          '/tmp/repo\0/tmp/worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 180,
          },
        },
      }),
    ).toMatchObject({
      filetreeViewStateByWorktreeByRepo: {
        '/tmp/repo': {
          '/tmp/worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 180,
          },
        },
      },
    })
  })
})

function branchTargetKey(repoRoot: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath: null })
}

function worktreeTargetKey(repoRoot: string, branchName: string, worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath })
}
