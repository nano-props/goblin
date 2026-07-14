import { beforeEach, describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoreRestorableWorkspaceStateFromSession,
  workspaceSessionStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

describe('restorable-workspace-state', () => {
  beforeEach(() => {
    resetReposStore()
  })

  test('maps restorable workspace state into ClientWorkspaceState', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
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
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            '/tmp/repo\0/tmp/worktree': 'term-222222222222222222222',
          },
        },
      }),
    ).toEqual({
      restoredRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/worktree': 'term-222222222222222222222',
      },
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: 'terminal' } },
      filetreeViewStateByWorktreeByRepo: {},
    })
  })

  test('persists workspace shell when an open repo has no branch read model', () => {
    const repo = emptyRepo('/tmp/repo-without-query-model', 'repo-without-query-model', 'repo-runtime-without-query')

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toEqual({
      restoredRepoId: repo.id,
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    })
  })

  test('preserves target-scoped baseline state for restore stub repos', () => {
    const activeTargetKey = worktreeTargetKey('/tmp/repo-a', 'feature/active', '/tmp/active-worktree')
    const stubTargetKey = worktreeTargetKey('/tmp/repo-b', 'feature/stub', '/tmp/stub-worktree')
    const activeRepo = seedRepoWithReadModelForTest({
      id: '/tmp/repo-a',
      branches: [createRepoBranch('feature/active', { worktree: { path: '/tmp/active-worktree' } })],
      currentBranchName: 'feature/active',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/active': [workspacePaneStaticTabEntry('status')],
      },
    })
    const stubRepo = emptyRepo('/tmp/repo-b', 'repo-b', 'repo-runtime-b')
    stubRepo.session = {
      entry: localRepoSessionEntry(stubRepo.id),
      projectionState: 'stub',
    }

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [activeRepo.id]: activeRepo, [stubRepo.id]: stubRepo },
        restorableWorkspaceState: {
          order: [activeRepo.id, stubRepo.id],
          restoredRepoId: activeRepo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            '/tmp/repo-a\0/tmp/active-worktree': 'term-active0000000000000',
            '/tmp/repo-b\0/tmp/stub-worktree': 'term-stub00000000000000',
          },
        },
        restoredSessionBaseline: {
          restoredRepoId: activeRepo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            '/tmp/repo-b\0/tmp/stub-worktree': 'term-stub00000000000000',
          },
          preferredWorkspacePaneTabByTargetByRepo: {
            [stubRepo.id]: { [stubTargetKey]: 'files' },
          },
          filetreeViewStateByWorktreeByRepo: {
            [stubRepo.id]: {
              '/tmp/stub-worktree': {
                selectedKeys: ['src/index.ts'],
                expandedKeys: ['src'],
                topVisibleRowIndex: 12,
              },
            },
          },
        },
      }),
    ).toEqual({
      restoredRepoId: activeRepo.id,
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo-a\0/tmp/active-worktree': 'term-active0000000000000',
        '/tmp/repo-b\0/tmp/stub-worktree': 'term-stub00000000000000',
      },
      preferredWorkspacePaneTabByTargetByRepo: {
        [activeRepo.id]: { [activeTargetKey]: 'status' },
        [stubRepo.id]: { [stubTargetKey]: 'files' },
      },
      filetreeViewStateByWorktreeByRepo: {
        [stubRepo.id]: {
          '/tmp/stub-worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 12,
          },
        },
      },
    })
  })

  test('persists changes as a session-restorable preferred tab when its static tab is open', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
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
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: 'changes' } },
    })
  })

  test('persists an explicit empty workspace pane preference', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: null,
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: null } },
    })
  })

  test('does not persist a branch preferred tab whose tab is closed', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
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
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByRepo: {},
    })
  })

  test('restores restorable workspace state from ClientWorkspaceState', () => {
    expect(
      restoreRestorableWorkspaceStateFromSession({
        restoredRepoId: '/tmp/repo',
        zenMode: false,
        workspacePaneSize: 40,
        selectedTerminalSessionIdByTerminalWorktree: {
          '/tmp/repo\0/tmp/worktree': 'term-111111111111111111111',
        },
        preferredWorkspacePaneTabByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      }),
    ).toEqual({
      restoredRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 40,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/worktree': 'term-111111111111111111111',
      },
      preferredWorkspacePaneTabByTargetByRepo: {},
    })
  })

  test('persists files as a session-restorable preferred tab when its static tab is open', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
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
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: 'files' } },
    })
  })

  test('uses server tab projection to validate a restorable preferred tab', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    const sessionState = workspaceSessionStateFromRestorableWorkspaceState({
      repos: { [repo.id]: repo },
      restorableWorkspaceState: {
        order: [repo.id],
        restoredRepoId: repo.id,
        zenMode: false,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
      },
    })
    const restored = restoreRestorableWorkspaceStateFromSession(sessionState)
    expect(restored.preferredWorkspacePaneTabByTargetByRepo).toEqual({
      '/tmp/repo': { [targetKey]: 'files' },
    })
  })

  test('persists file tree view state into session state', () => {
    const repo = seedRepoWithReadModelForTest({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          restoredRepoId: repo.id,
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
