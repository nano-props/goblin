import { beforeEach, describe, expect, test } from 'vitest'
import { localWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import {
  restoreRestorableWorkspaceStateFromClientWorkspace,
  clientWorkspaceStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createBranchSnapshot, resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoWorktreeStatusQueryKey } from '#/web/repo-data-query.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('restorable-workspace-state', () => {
  beforeEach(() => {
    resetWorkspacesStore()
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
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(repo.id, repo.workspaceRuntimeId) })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-222222222222222222222',
          },
        },
      }),
    ).toEqual({
      restoredWorkspaceId: 'goblin+file:///tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-222222222222222222222',
      },
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: 'terminal' } },
      filetreeViewStateByWorktreeByWorkspace: {},
    })
  })

  test('persists workspace shell when an open repo has no branch read model', () => {
    const repo = emptyWorkspace(
      'goblin+file:///tmp/repo-without-query-model',
      'repo-without-query-model',
      'repo-runtime-without-query',
    )
    acceptWorkspaceProbeState(repo, {
      status: 'ready',
      name: 'repo-without-query-model',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(repo.id, repo.id)
    const workspaceRootTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'workspace-root',
      workspaceId: repo.id,
    })
    repo.ui.preferredWorkspacePaneTabByTarget[workspaceRootTargetKey] = 'files'

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            [terminalWorktreeKey]: 'term-workspaceroot0000001',
          },
        },
      }),
    ).toEqual({
      restoredWorkspaceId: repo.id,
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        [terminalWorktreeKey]: 'term-workspaceroot0000001',
      },
      preferredWorkspacePaneTabByTargetByWorkspace: {
        [repo.id]: { [workspaceRootTargetKey]: 'files' },
      },
      filetreeViewStateByWorktreeByWorkspace: {},
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
    const stubRepo = emptyWorkspace('goblin+file:///tmp/repo-b', 'repo-b', 'repo-runtime-b')
    stubRepo.session = {
      entry: localWorkspaceSessionEntry(stubRepo.id),
      projectionState: 'stub',
    }

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        workspaces: { [activeRepo.id]: activeRepo, [stubRepo.id]: stubRepo },
        restorableWorkspaceState: {
          workspaceOrder: [activeRepo.id, stubRepo.id],
          restoredWorkspaceId: activeRepo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            'goblin+file:///tmp/repo-a\0goblin+file:///tmp/active-worktree': 'term-active0000000000000',
            'goblin+file:///tmp/repo-b\0goblin+file:///tmp/stub-worktree': 'term-stub00000000000000',
          },
        },
        restoredClientWorkspaceBaseline: {
          restoredWorkspaceId: activeRepo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            'goblin+file:///tmp/repo-b\0goblin+file:///tmp/stub-worktree': 'term-stub00000000000000',
          },
          preferredWorkspacePaneTabByTargetByWorkspace: {
            [stubRepo.id]: { [stubTargetKey]: 'files' },
          },
          filetreeViewStateByWorktreeByWorkspace: {
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
      restoredWorkspaceId: activeRepo.id,
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        'goblin+file:///tmp/repo-a\0goblin+file:///tmp/active-worktree': 'term-active0000000000000',
        'goblin+file:///tmp/repo-b\0goblin+file:///tmp/stub-worktree': 'term-stub00000000000000',
      },
      preferredWorkspacePaneTabByTargetByWorkspace: {
        [activeRepo.id]: { [activeTargetKey]: 'status' },
        [stubRepo.id]: { [stubTargetKey]: 'files' },
      },
      filetreeViewStateByWorktreeByWorkspace: {
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
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: 'changes' } },
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
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: null } },
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
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByWorkspace: {},
    })
  })

  test('restores restorable workspace state from ClientWorkspaceState', () => {
    expect(
      restoreRestorableWorkspaceStateFromClientWorkspace({
        restoredWorkspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
        zenMode: false,
        workspacePaneSize: 40,
        selectedTerminalSessionIdByTerminalWorktree: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-111111111111111111111',
        },
        preferredWorkspacePaneTabByTargetByWorkspace: {},
        filetreeViewStateByWorktreeByWorkspace: {},
      }),
    ).toEqual({
      restoredWorkspaceId: 'goblin+file:///tmp/repo',
      zenMode: false,
      workspacePaneSize: 40,
      selectedTerminalSessionIdByTerminalWorktree: {
        'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-111111111111111111111',
      },
      preferredWorkspacePaneTabByTargetByWorkspace: {},
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
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: 'files' } },
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
      workspaces: { [repo.id]: repo },
      restorableWorkspaceState: {
        workspaceOrder: [repo.id],
        restoredWorkspaceId: repo.id,
        zenMode: false,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
      },
    })
    const restored = restoreRestorableWorkspaceStateFromClientWorkspace(sessionState)
    expect(restored.preferredWorkspacePaneTabByTargetByWorkspace).toEqual({
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
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
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
      filetreeViewStateByWorktreeByWorkspace: {
        'goblin+file:///tmp/repo': {
          'goblin+file:///tmp/worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 180,
          },
        },
      },
    })
  })
})

function branchTargetKey(workspaceId: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({
    kind: 'git-branch',
    workspaceId: workspaceIdForTest(workspaceId),
    branchName,
  })
}

function worktreeTargetKey(workspaceId: string, branchName: string, worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({
    kind: 'git-worktree',
    workspaceId: workspaceIdForTest(workspaceId),
    worktreePath,
  })
}
