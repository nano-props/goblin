import {
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test } from 'vitest'
import { localWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import {
  restoreRestorableWorkspaceStateFromClientWorkspace,
  clientWorkspaceStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { restoreFiletreeViewStateFromSession } from '#/web/filetree-session-state.ts'
import {
  filetreeInteractionScopeKey,
  filetreeInteractionStore,
  resetFiletreeInteractionStore,
} from '#/web/stores/workspaces/filetree-interaction-state.ts'

describe('restorable-workspace-state', () => {
  beforeEach(() => {
    resetWorkspacesStore()
    resetFiletreeInteractionStore()
  })

  test('maps restorable workspace state into ClientWorkspaceState', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/worktree')],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    appQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(repo.id, repo.workspaceRuntimeId) })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-222222222222222222222',
          },
          branchViewModeByWorkspace: { [repo.id]: 'worktrees' },
        },
      }),
    ).toEqual({
      restoredWorkspaceId: 'goblin+file:///tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-222222222222222222222',
      },
      branchViewModeByWorkspace: { 'goblin+file:///tmp/repo': 'worktrees' },
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: 'terminal' } },
      filetreeViewStateByFilesystemTargetByWorkspace: {},
    })
  })

  test('persists a plain Workspace root without synthetic Git targets', () => {
    const workspace = emptyWorkspace('goblin+file:///tmp/repo-without-query-model', 'repo-runtime-without-query')
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(workspace.id, workspace.id)
    const workspaceRootTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'workspace-root',
      workspaceId: workspace.id,
    })
    workspace.ui.preferredWorkspacePaneTabByTarget[workspaceRootTargetKey] = 'files'
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId: workspace.id,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
    })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        workspaces: { [workspace.id]: workspace },
        restorableWorkspaceState: {
          workspaceOrder: [workspace.id],
          restoredWorkspaceId: workspace.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            [terminalFilesystemTargetKey]: 'term-workspaceroot0000001',
          },
          branchViewModeByWorkspace: {},
        },
      }),
    ).toEqual({
      restoredWorkspaceId: workspace.id,
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        [terminalFilesystemTargetKey]: 'term-workspaceroot0000001',
      },
      branchViewModeByWorkspace: {},
      preferredWorkspacePaneTabByTargetByWorkspace: {
        [workspace.id]: { [workspaceRootTargetKey]: 'files' },
      },
      filetreeViewStateByFilesystemTargetByWorkspace: {},
    })
  })

  test('drops target-scoped state for worktrees absent from authoritative worktree membership', () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('main')],
      currentBranchName: 'main',
    })
    const staleWorktreePath = '/tmp/stale-worktree'
    const staleTargetKey = worktreeTargetKey(repo.id, staleWorktreePath)
    repo.ui.preferredWorkspacePaneTabByTarget[staleTargetKey] = 'files'
    const staleTerminalTargetKey = formatTerminalFilesystemTargetKey(
      repo.id,
      workspaceIdForTest('goblin+file:///tmp/stale-worktree'),
    )

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          branchViewModeByWorkspace: {},
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            [staleTerminalTargetKey]: 'term-stale00000000000000',
          },
        },
      }),
    ).toMatchObject({
      selectedTerminalSessionIdByTerminalFilesystemTarget: {},
      preferredWorkspacePaneTabByTargetByWorkspace: {},
    })
  })

  test('rejects a branch target after that branch materializes as a worktree', () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/materialized')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/materialized', '/tmp/materialized-worktree')],
      currentBranchName: 'feature/materialized',
    })
    const staleBranchTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: repo.id,
      branchName: 'feature/materialized',
    })
    repo.ui.preferredWorkspacePaneTabByTarget[staleBranchTargetKey] = 'history'
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-branch',
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/materialized',
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    expect(
      clientWorkspaceStateFromRestorableWorkspaceState({
        workspaces: { [repo.id]: repo },
        restorableWorkspaceState: {
          workspaceOrder: [repo.id],
          restoredWorkspaceId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          branchViewModeByWorkspace: {},
          selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        },
      }).preferredWorkspacePaneTabByTargetByWorkspace,
    ).toEqual({})
  })

  test('persists and restores detached and rebasing worktree session state from worktree membership', () => {
    const detachedPath = '/tmp/detached-worktree'
    const rebasingPath = '/tmp/rebasing-worktree'
    const detachedTargetKey = worktreeTargetKey('goblin+file:///tmp/repo', detachedPath)
    const rebasingTargetKey = worktreeTargetKey('goblin+file:///tmp/repo', rebasingPath)
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('main')],
      currentBranchName: 'main',
      worktrees: [
        {
          path: detachedPath,
          head: { kind: 'detached' },
          headOid: '1111111111111111111111111111111111111111',
          operation: null,
          materializedBranch: null,
          isPrimary: false,
          isLocked: false,
        },
        {
          path: rebasingPath,
          head: { kind: 'detached' },
          headOid: '2222222222222222222222222222222222222222',
          operation: { kind: 'rebase' },
          materializedBranch: 'feature/rebase',
          isPrimary: false,
          isLocked: false,
        },
      ],
    })
    repo.ui.preferredWorkspacePaneTabByTarget[detachedTargetKey] = 'files'
    repo.ui.preferredWorkspacePaneTabByTarget[rebasingTargetKey] = 'terminal'
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree',
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: detachedPath,
      tabs: [workspacePaneStaticTabEntry('files')],
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree',
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: rebasingPath,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const detachedTerminalTargetKey = formatTerminalFilesystemTargetKey(
      repo.id,
      workspaceIdForTest('goblin+file:///tmp/detached-worktree'),
    )
    const rebasingTerminalTargetKey = formatTerminalFilesystemTargetKey(
      repo.id,
      workspaceIdForTest('goblin+file:///tmp/rebasing-worktree'),
    )

    const persisted = clientWorkspaceStateFromRestorableWorkspaceState({
      workspaces: { [repo.id]: repo },
      restorableWorkspaceState: {
        workspaceOrder: [repo.id],
        restoredWorkspaceId: repo.id,
        zenMode: false,
        workspacePaneSize: 55,
        branchViewModeByWorkspace: {},
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          [detachedTerminalTargetKey]: 'term-detached00000000000',
          [rebasingTerminalTargetKey]: 'term-rebasing00000000000',
        },
      },
      filetreeInteractionByScope: {
        [filetreeInteractionScopeKey(repo.id, detachedPath)]: {
          selectedKeys: ['detached.ts'],
          expandedKeys: ['src'],
          topVisibleRowIndex: 12,
        },
        [filetreeInteractionScopeKey(repo.id, rebasingPath)]: {
          selectedKeys: ['rebasing.ts'],
          expandedKeys: ['packages'],
          topVisibleRowIndex: 34,
        },
      },
    })

    expect(persisted.preferredWorkspacePaneTabByTargetByWorkspace[repo.id]).toEqual({
      [detachedTargetKey]: 'files',
      [rebasingTargetKey]: 'terminal',
    })
    expect(persisted.selectedTerminalSessionIdByTerminalFilesystemTarget).toEqual({
      [detachedTerminalTargetKey]: 'term-detached00000000000',
      [rebasingTerminalTargetKey]: 'term-rebasing00000000000',
    })
    expect(persisted.filetreeViewStateByFilesystemTargetByWorkspace[repo.id]).toEqual({
      'goblin+file:///tmp/detached-worktree': {
        selectedKeys: ['detached.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 12,
      },
      'goblin+file:///tmp/rebasing-worktree': {
        selectedKeys: ['rebasing.ts'],
        expandedKeys: ['packages'],
        topVisibleRowIndex: 34,
      },
    })

    const restored = restoreRestorableWorkspaceStateFromClientWorkspace(persisted)
    expect(restored.preferredWorkspacePaneTabByTargetByWorkspace[repo.id]).toEqual({
      [detachedTargetKey]: 'files',
      [rebasingTargetKey]: 'terminal',
    })
    expect(restored.selectedTerminalSessionIdByTerminalFilesystemTarget).toEqual({
      [detachedTerminalTargetKey]: 'term-detached00000000000',
      [rebasingTerminalTargetKey]: 'term-rebasing00000000000',
    })

    restoreFiletreeViewStateFromSession(persisted.filetreeViewStateByFilesystemTargetByWorkspace)
    expect(filetreeInteractionStore.getState().interactionByScope).toMatchObject({
      [filetreeInteractionScopeKey(repo.id, detachedPath)]: {
        selectedKeys: ['detached.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 12,
      },
      [filetreeInteractionScopeKey(repo.id, rebasingPath)]: {
        selectedKeys: ['rebasing.ts'],
        expandedKeys: ['packages'],
        topVisibleRowIndex: 34,
      },
    })
  })

  test('preserves target-scoped baseline state for restore stub Workspaces', () => {
    const activeTargetKey = worktreeTargetKey('goblin+file:///tmp/repo-a', '/tmp/active-worktree')
    const stubTargetKey = worktreeTargetKey('goblin+file:///tmp/repo-b', '/tmp/stub-worktree')
    const activeRepo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo-a',
      branchSnapshots: [createBranchSnapshot('feature/active')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/active', '/tmp/active-worktree')],
      currentBranchName: 'feature/active',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/active': [workspacePaneStaticTabEntry('status')],
      },
    })
    const stubRepo = emptyWorkspace('goblin+file:///tmp/repo-b', 'repo-runtime-b')
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
          branchViewModeByWorkspace: { [activeRepo.id]: 'worktrees' },
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            'goblin+file:///tmp/repo-a\0goblin+file:///tmp/active-worktree': 'term-active0000000000000',
            'goblin+file:///tmp/repo-b\0goblin+file:///tmp/stub-worktree': 'term-stub00000000000000',
          },
        },
        restoredClientWorkspaceBaseline: {
          restoredWorkspaceId: activeRepo.id,
          zenMode: false,
          workspacePaneSize: 55,
          branchViewModeByWorkspace: { [stubRepo.id]: 'worktrees' },
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            'goblin+file:///tmp/repo-b\0goblin+file:///tmp/stub-worktree': 'term-stub00000000000000',
          },
          preferredWorkspacePaneTabByTargetByWorkspace: {
            [stubRepo.id]: { [stubTargetKey]: 'files' },
          },
          filetreeViewStateByFilesystemTargetByWorkspace: {
            [stubRepo.id]: {
              'goblin+file:///tmp/stub-worktree': {
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
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        'goblin+file:///tmp/repo-a\0goblin+file:///tmp/active-worktree': 'term-active0000000000000',
        'goblin+file:///tmp/repo-b\0goblin+file:///tmp/stub-worktree': 'term-stub00000000000000',
      },
      branchViewModeByWorkspace: { [activeRepo.id]: 'worktrees', [stubRepo.id]: 'worktrees' },
      preferredWorkspacePaneTabByTargetByWorkspace: {
        [activeRepo.id]: { [activeTargetKey]: 'status' },
        [stubRepo.id]: { [stubTargetKey]: 'files' },
      },
      filetreeViewStateByFilesystemTargetByWorkspace: {
        [stubRepo.id]: {
          'goblin+file:///tmp/stub-worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 12,
          },
        },
      },
    })
  })

  test('persists changes as a session-restorable preferred tab when its static tab is open', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/worktree')],
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
          branchViewModeByWorkspace: {},
          selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: 'changes' } },
    })
  })

  test('persists an explicit empty workspace pane preference', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/worktree')],
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
          branchViewModeByWorkspace: {},
          selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: null } },
    })
  })

  test('does not persist a branch preferred tab whose tab is closed', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/worktree')],
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
          branchViewModeByWorkspace: {},
          selectedTerminalSessionIdByTerminalFilesystemTarget: {},
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
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-111111111111111111111',
        },
        branchViewModeByWorkspace: {},
        preferredWorkspacePaneTabByTargetByWorkspace: {},
        filetreeViewStateByFilesystemTargetByWorkspace: {},
      }),
    ).toEqual({
      restoredWorkspaceId: 'goblin+file:///tmp/repo',
      zenMode: false,
      workspacePaneSize: 40,
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        'goblin+file:///tmp/repo\0goblin+file:///tmp/worktree': 'term-111111111111111111111',
      },
      branchViewModeByWorkspace: {},
      preferredWorkspacePaneTabByTargetByWorkspace: {},
    })
  })

  test('persists files as a session-restorable preferred tab when its static tab is open', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/worktree')],
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
          branchViewModeByWorkspace: {},
          selectedTerminalSessionIdByTerminalFilesystemTarget: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: 'files' } },
    })
  })

  test('uses server tab projection to validate a restorable preferred tab', () => {
    const targetKey = worktreeTargetKey('goblin+file:///tmp/repo', '/tmp/worktree')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/worktree')],
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
        branchViewModeByWorkspace: {},
        selectedTerminalSessionIdByTerminalFilesystemTarget: {},
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
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/worktree')],
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
          branchViewModeByWorkspace: {},
          selectedTerminalSessionIdByTerminalFilesystemTarget: {},
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
      filetreeViewStateByFilesystemTargetByWorkspace: {
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

function worktreeTargetKey(workspaceId: string, worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({
    kind: 'git-worktree',
    workspaceId: workspaceIdForTest(workspaceId),
    worktreePath,
  })
}
