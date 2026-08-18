import {
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test } from 'vitest'
import { appQueryClient } from '#/web/app/query-client.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  filesystemWorkspacePaneTargetLeaseIsCurrent,
  gitWorktreePaneTargetLease,
  resolveWorkspacePaneTabTargetForPaneTarget,
  scopeWorkspacePaneTabTargetResolutionToRuntime,
  workspacePaneTabTargetForPaneTarget,
  workspacePaneTabTargetForWorkspace,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { tabOpenerScopeKey } from '#/web/stores/workspaces/tab-opener.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repos/query-keys.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  workspacePaneLocationForLinkedWorktree,
  workspacePaneLocationForRoot,
  workspacePaneLocationForWorktree,
} from '#/web/workspace-pane/workspace-pane-location.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneTabModelBranchName,
  workspacePaneTabModelWorktreePath,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-target-repo')
const WORKTREE_PATH = '/tmp/workspace-pane-target-worktree'

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
})

describe('workspace pane tab target read model', () => {
  test('models the workspace root as a workspace target rather than an empty branch', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,

      tabs: [workspacePaneStaticTabEntry('files')],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: REPO_ID }, 'files')

    const target = workspacePaneTabTargetForWorkspace(REPO_ID)
    if (!target) throw new Error('expected workspace root target')

    expect(workspacePaneTabModelBranchName(target)).toBeNull()
    expect(workspacePaneTabModelWorktreePath(target)).toBe('/tmp/workspace-pane-target-repo')
    expect(target.renderedTab).toBe('files')
  })

  test('keeps source-worktree and root preferences separate over their shared layout', () => {
    const sourceWorktree = createRepoWorktreeSnapshotForTest('main', '/tmp/workspace-pane-target-repo', {
      isSource: true,
      isPrimary: true,
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      worktrees: [sourceWorktree],
      currentBranchName: 'main',
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
        workspacePaneStaticTabEntry('files'),
      ],
    })
    workspacesStore
      .getState()
      .setWorkspacePaneTabForTarget(
        { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: sourceWorktree.path },
        'history',
      )
    workspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: REPO_ID }, 'files')

    const sourceTarget = workspacePaneTabTargetForPaneTarget({
      location: workspacePaneLocationForWorktree(REPO_ID, repo.workspaceRuntimeId, sourceWorktree),
      workspacePaneRoute: undefined,
    })
    const rootTarget = workspacePaneTabTargetForPaneTarget({
      location: workspacePaneLocationForRoot(REPO_ID, repo.workspaceRuntimeId),
      workspacePaneRoute: undefined,
    })

    expect(sourceTarget?.location?.paneTarget).toEqual({ kind: 'workspace-root', workspaceId: REPO_ID })
    expect(sourceTarget?.renderedTab).toBe('history')
    expect(rootTarget?.renderedTab).toBe('files')
  })

  test('keeps an unavailable read target distinct from a ready authority target', () => {
    const repo = emptyWorkspace(REPO_ID, 'repo-runtime-workspace-pane-no-tabs')
    markGitAvailable(repo)
    workspacesStore.setState((s) => ({
      workspaces: { ...s.workspaces, [REPO_ID]: repo },
      workspaceOrder: [...s.workspaceOrder, REPO_ID],
      restoredWorkspaceId: REPO_ID,
    }))
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/query')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/query', WORKTREE_PATH)],
      currentBranch: 'feature/query',
    })
    appQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    const paneTarget = requiredGitWorkspacePaneTabsTarget(REPO_ID, 'feature/query', WORKTREE_PATH)
    if (paneTarget.kind !== 'git-worktree') throw new Error('expected worktree target')
    const input = {
      location: workspacePaneLocationForLinkedWorktree(paneTarget, repo.workspaceRuntimeId, {
        kind: 'branch' as const,
        branchName: 'feature/query',
      }),
      workspacePaneRoute: undefined,
    }
    const resolution = resolveWorkspacePaneTabTargetForPaneTarget(input)
    expect(resolution).toMatchObject({
      kind: 'unavailable',
      reason: 'workspace-pane-tabs-pending',
      target: { tabEntriesProjectionPhase: 'pending' },
    })
    expect(scopeWorkspacePaneTabTargetResolutionToRuntime(resolution, repo.workspaceRuntimeId)).toBe(resolution)
    expect(scopeWorkspacePaneTabTargetResolutionToRuntime(resolution, 'repo-runtime-replaced')).toEqual({
      kind: 'missing',
    })
    expect(workspacePaneTabTargetForPaneTarget(input)).toBeNull()
  })

  test('keeps a worktree command lease current when a background status refresh fails with accepted data', async () => {
    const repo = seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/query', WORKTREE_PATH)],
      id: REPO_ID,
      branches: [createRepoBranch('feature/query')],
      currentBranchName: 'feature/query',
      status: [{ path: WORKTREE_PATH, branch: 'feature/query', isMain: false, entries: [] }],
    })
    const lease = gitWorktreePaneTargetLease(REPO_ID, repo.workspaceRuntimeId, WORKTREE_PATH)

    expect(filesystemWorkspacePaneTargetLeaseIsCurrent(lease)).toBe(true)

    await expect(
      appQueryClient.fetchQuery({
        queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
        queryFn: async () => {
          throw new Error('status unavailable')
        },
        retry: false,
      }),
    ).rejects.toThrow('status unavailable')

    expect(appQueryClient.getQueryData(repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId))).toBeDefined()
    expect(filesystemWorkspacePaneTargetLeaseIsCurrent(lease)).toBe(true)
  })

  test('keeps a branch command lease current when a background snapshot refresh fails with accepted data', async () => {
    const repo = seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/query', WORKTREE_PATH)],
      id: REPO_ID,
      branches: [createRepoBranch('feature/query')],
      currentBranchName: 'feature/query',
      status: [{ path: WORKTREE_PATH, branch: 'feature/query', isMain: false, entries: [] }],
    })
    const lease = gitWorktreePaneTargetLease(REPO_ID, repo.workspaceRuntimeId, WORKTREE_PATH)
    const queryKey = repoSnapshotQueryKey(REPO_ID, repo.workspaceRuntimeId)

    expect(filesystemWorkspacePaneTargetLeaseIsCurrent(lease)).toBe(true)

    await expect(
      appQueryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          throw new Error('snapshot unavailable')
        },
        retry: false,
      }),
    ).rejects.toThrow('snapshot unavailable')

    expect(appQueryClient.getQueryData(queryKey)).toBeDefined()
    expect(filesystemWorkspacePaneTargetLeaseIsCurrent(lease)).toBe(true)
  })

  test('resolves a created runtime by worktree while its canonical branch rename is not projected locally', () => {
    const repo = seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/old', WORKTREE_PATH)],
      id: REPO_ID,
      branches: [createRepoBranch('feature/old')],
      currentBranchName: 'feature/old',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/old')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/old', WORKTREE_PATH)],
      currentBranch: 'feature/old',
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    const paneTarget = requiredGitWorkspacePaneTabsTarget(REPO_ID, 'feature/renamed', WORKTREE_PATH)
    const target = workspacePaneTabTargetForPaneTarget({
      location: workspacePaneLocationForLinkedWorktree(
        { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
        repo.workspaceRuntimeId,
        { kind: 'branch', branchName: 'feature/renamed' },
      ),
      workspacePaneRoute: undefined,
    })

    expect(target?.location?.branchName).toBe('feature/renamed')
    expect(target?.location?.routeTarget).toMatchObject({ kind: 'git-worktree', worktreePath: WORKTREE_PATH })
  })

  test('treats an explicit empty worktree route as an empty workspace pane', () => {
    const repo = seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/query', WORKTREE_PATH)],
      id: REPO_ID,
      branches: [createRepoBranch('feature/query')],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })

    const paneTarget = requiredGitWorkspacePaneTabsTarget(REPO_ID, 'feature/query', WORKTREE_PATH)
    const target = workspacePaneTabTargetForPaneTarget({
      location: workspacePaneLocationForLinkedWorktree(
        { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
        repo.workspaceRuntimeId,
        { kind: 'branch', branchName: 'feature/query' },
      ),
      workspacePaneRoute: null,
    })

    expect(target?.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status', 'workspace-pane:history'])
    expect(target?.activeTab).toBeNull()
    expect(target?.renderedTab).toBeNull()
  })

  test('records tab openers from the TanStack Query snapshot when store branches are stale', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/query')],
      currentBranch: 'feature/query',
    })

    recordWorkspacePaneTabOpener(
      { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/query' },
      repo.workspaceRuntimeId,
      'workspace-pane:changes',
      'workspace-pane:status',
    )

    expect(
      workspacesStore.getState().tabOpenerIdentityByScope[
        `${tabOpenerScopeKey({ kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/query' })}\0${repo.workspaceRuntimeId}`
      ]?.['workspace-pane:changes'],
    ).toBe('workspace-pane:status')
  })

  test('scopes worktree tab openers by workspace pane target instead of branch name', () => {
    const repo = seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/old', WORKTREE_PATH)],
      id: REPO_ID,
      branches: [createRepoBranch('feature/old')],
      currentBranchName: 'feature/old',
    })

    expect(
      recordWorkspacePaneTabOpener(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          worktreePath: WORKTREE_PATH,
        },
        repo.workspaceRuntimeId,
        'workspace-pane:changes',
        'workspace-pane:status',
      ),
    ).toBe('recorded')
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/new')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/new', WORKTREE_PATH)],
      currentBranch: 'feature/new',
    })

    expect(
      workspacePaneTabOpener(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          worktreePath: WORKTREE_PATH,
        },
        repo.workspaceRuntimeId,
        'workspace-pane:changes',
      ),
    ).toBe('workspace-pane:status')
  })

  test('keeps detached worktree openers isolated from workspace-root and branch targets', async () => {
    const repo = emptyWorkspace(REPO_ID, 'repo-runtime-detached-opener')
    workspacesStore.setState((state) => ({
      workspaces: { ...state.workspaces, [REPO_ID]: repo },
      workspaceOrder: [...state.workspaceOrder, REPO_ID],
      restoredWorkspaceId: REPO_ID,
    }))
    const detachedTarget = {
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
      worktreePath: WORKTREE_PATH,
    }
    const workspaceTarget = { kind: 'workspace-root' as const, workspaceId: REPO_ID }
    const branchTarget = { kind: 'git-branch' as const, workspaceId: REPO_ID, branchName: 'feature/query' }

    expect(
      recordWorkspacePaneTabOpener(
        detachedTarget,
        repo.workspaceRuntimeId,
        'terminal:term-111111111111111111111',
        'workspace-pane:files',
      ),
    ).toBe('recorded')
    expect(workspacePaneTabOpener(detachedTarget, repo.workspaceRuntimeId, 'terminal:term-111111111111111111111')).toBe(
      'workspace-pane:files',
    )
    expect(
      workspacePaneTabOpener(workspaceTarget, repo.workspaceRuntimeId, 'terminal:term-111111111111111111111'),
    ).toBeNull()
    expect(
      workspacePaneTabOpener(branchTarget, repo.workspaceRuntimeId, 'terminal:term-111111111111111111111'),
    ).toBeNull()
  })

  test('records against a canonical branch target without requiring a branch read model', async () => {
    const repo = emptyWorkspace(REPO_ID, 'repo-runtime-workspace-pane-no-query')
    workspacesStore.setState((s) => ({
      workspaces: { ...s.workspaces, [REPO_ID]: repo },
      workspaceOrder: [...s.workspaceOrder, REPO_ID],
      restoredWorkspaceId: REPO_ID,
    }))

    expect(
      recordWorkspacePaneTabOpener(
        { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/query' },
        repo.workspaceRuntimeId,
        'workspace-pane:changes',
        'workspace-pane:status',
      ),
    ).toBe('recorded')
  })
})

function markGitAvailable(repo: ReturnType<typeof emptyWorkspace>): void {
  acceptWorkspaceProbeState(repo, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  })
}
