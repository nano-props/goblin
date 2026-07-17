import { beforeEach, describe, expect, test } from 'vitest'
import { localWorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoreRestorableWorkspaceStateFromClientWorkspace,
  clientWorkspaceStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createBranchSnapshot, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoWorktreeStatusQueryKey } from '#/web/repo-data-query.ts'

describe('restorable-workspace-state', () => {
  beforeEach(() => {
    resetReposStore()
  })

  test('maps restorable workspace state into ClientWorkspaceState', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(repo.id, repo.repoRuntimeId) })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            'goblin+file:///tmp/repo\0/tmp/worktree': 'term-222222222222222222222',
          },
        },
      }),
    ).toEqual({
      restoredRepoId: 'goblin+file:///tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        'goblin+file:///tmp/repo\0/tmp/worktree': 'term-222222222222222222222',
      },
      preferredWorkspacePaneTabByTargetByRepo: { 'goblin+file:///tmp/repo': { [targetKey]: 'terminal' } },
      filetreeViewStateByWorktreeByRepo: {},
    })
  })

  test('persists workspace shell when an open repo has no branch read model', () => {
    const repo = emptyRepo('/tmp/repo-without-query-model', 'repo-without-query-model', 'repo-runtime-without-query')

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
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
    const activeTargetKey = worktreeTargetKey('goblin+file:///tmp/repo-a', 'feature/active', '/tmp/active-worktree')
    const stubTargetKey = worktreeTargetKey('goblin+file:///tmp/repo-b', 'feature/stub', '/tmp/stub-worktree')
    const activeRepo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo-a',
      branchSnapshots: [createBranchSnapshot('feature/active', { worktree: { path: '/tmp/active-worktree' } })],
      currentBranchName: 'feature/active',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/active': [workspacePaneStaticTabEntry('status')],
      },
    })
    const stubRepo = emptyRepo('goblin+file:///tmp/repo-b', 'repo-b', 'repo-runtime-b')
    stubRepo.session = {
      entry: localWorkspaceSessionEntry(stubRepo.id),
      projectionState: 'stub',
    }

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        repos: { [activeRepo.id]: activeRepo, [stubRepo.id]: stubRepo },
        restorableWorkspaceState: {
          order: [activeRepo.id, stubRepo.id],
          restoredRepoId: activeRepo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            'goblin+file:///tmp/repo-a\0/tmp/active-worktree': 'term-active0000000000000',
            'goblin+file:///tmp/repo-b\0/tmp/stub-worktree': 'term-stub00000000000000',
          },
        },
        restoredClientWorkspaceBaseline: {
          restoredRepoId: activeRepo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            'goblin+file:///tmp/repo-b\0/tmp/stub-worktree': 'term-stub00000000000000',
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
        'goblin+file:///tmp/repo-a\0/tmp/active-worktree': 'term-active0000000000000',
        'goblin+file:///tmp/repo-b\0/tmp/stub-worktree': 'term-stub00000000000000',
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
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
      },
    })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
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
      preferredWorkspacePaneTabByTargetByRepo: { 'goblin+file:///tmp/repo': { [targetKey]: 'changes' } },
    })
  })

  test('persists an explicit empty workspace pane preference', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: null,
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
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
      preferredWorkspacePaneTabByTargetByRepo: { 'goblin+file:///tmp/repo': { [targetKey]: null } },
    })
  })

  test('does not persist a branch preferred tab whose tab is closed', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
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
      restoreRestorableWorkspaceStateFromClientWorkspace({
        restoredRepoId: 'goblin+file:///tmp/repo',
        zenMode: false,
        workspacePaneSize: 40,
        selectedTerminalSessionIdByTerminalWorktree: {
          'goblin+file:///tmp/repo\0/tmp/worktree': 'term-111111111111111111111',
        },
        preferredWorkspacePaneTabByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      }),
    ).toEqual({
      restoredRepoId: 'goblin+file:///tmp/repo',
      zenMode: false,
      workspacePaneSize: 40,
      selectedTerminalSessionIdByTerminalWorktree: {
        'goblin+file:///tmp/repo\0/tmp/worktree': 'term-111111111111111111111',
      },
      preferredWorkspacePaneTabByTargetByRepo: {},
    })
  })

  test('persists files as a session-restorable preferred tab when its static tab is open', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
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
      preferredWorkspacePaneTabByTargetByRepo: { 'goblin+file:///tmp/repo': { [targetKey]: 'files' } },
    })
  })

  test('uses server tab projection to validate a restorable preferred tab', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    const sessionState = clientWorkspaceStateFromRestorableWorkspaceState({
      repos: { [repo.id]: repo },
      restorableWorkspaceState: {
        order: [repo.id],
        restoredRepoId: repo.id,
        zenMode: false,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
      },
    })
    const restored = restoreRestorableWorkspaceStateFromClientWorkspace(sessionState)
    expect(restored.preferredWorkspacePaneTabByTargetByRepo).toEqual({
      'goblin+file:///tmp/repo': { [targetKey]: 'files' },
    })
  })

  test('persists file tree view state into session state', () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      currentBranchName: 'feature/worktree',
    })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          restoredRepoId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
        filetreeInteractionByScope: {
          'goblin+file:///tmp/repo\0/tmp/worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 180,
          },
        },
      }),
    ).toMatchObject({
      filetreeViewStateByWorktreeByRepo: {
        'goblin+file:///tmp/repo': {
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
