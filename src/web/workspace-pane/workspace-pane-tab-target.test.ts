import { beforeEach, describe, expect, test } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
  workspacePanePreferenceTargetOptions,
  workspacePaneTabInteractionBlockedForBranch,
  workspacePaneTabTargetForBranch,
  workspacePaneTabTargetForCreatedRuntime,
  workspacePaneTabTargetForWorkspace,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { repoWorktreeStatusQueryKey } from '#/web/repo-data-query.ts'

const REPO_ID = 'goblin+file:///tmp/workspace-pane-target-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-target-worktree'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
})

describe('workspace pane tab target read model', () => {
  test('models the workspace root as a workspace target rather than an empty branch', () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,

      tabs: [workspacePaneStaticTabEntry('files')],
    })
    useReposStore
      .getState()
      .setWorkspacePaneTabForTarget(
        { kind: 'workspace-root', repoRoot: REPO_ID },
        'files',
      )

    const target = workspacePaneTabTargetForWorkspace(REPO_ID)

    expect(target).toMatchObject({ branchName: null, worktreePath: '/tmp/workspace-pane-target-repo', renderedTab: 'files' })
  })

  test('marks target resolution unavailable when the repo branch read model is unavailable', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-runtime-workspace-pane-no-query')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      restoredRepoId: REPO_ID,
    }))

    expect(
      resolveWorkspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions),
    ).toEqual({
      kind: 'unavailable',
      reason: 'branch-read-model-unavailable',
    })
    expect(workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions)).toBeNull()
  })

  test('marks target resolution unavailable while workspace pane tabs projection is not ready', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-runtime-workspace-pane-no-tabs')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      restoredRepoId: REPO_ID,
    }))
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/query',
    })
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    expect(
      resolveWorkspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions),
    ).toEqual({
      kind: 'unavailable',
      reason: 'workspace-pane-tabs-pending',
    })
    expect(workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions)).toBeNull()
    expect(
      workspacePaneTabInteractionBlockedForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions),
    ).toBe(true)
  })

  test('resolves branch targets from the React Query projection when store branches are stale', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/query',
    })
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    const target = workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', workspacePanePreferenceTargetOptions)

    expect(target?.branchName).toBe('feature/query')
    expect(target?.worktreePath).toBe(WORKTREE_PATH)
    expect(target?.renderedTab).toBe('status')
  })

  test('resolves a created runtime by worktree while its canonical branch rename is not projected locally', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/old', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/old',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/old', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/old',
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    const target = workspacePaneTabTargetForCreatedRuntime(
      REPO_ID,
      'feature/renamed',
      WORKTREE_PATH,
      workspacePanePreferenceTargetOptions,
    )

    expect(target?.branchName).toBe('feature/renamed')
    expect(target?.worktreePath).toBe(WORKTREE_PATH)
  })

  test('treats an explicit bare branch route as an empty workspace pane', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })

    const target = workspacePaneTabTargetForBranch(REPO_ID, 'feature/query', { workspacePaneRoute: null })

    expect(target?.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status', 'workspace-pane:history'])
    expect(target?.activeTab).toBeNull()
    expect(target?.renderedTab).toBeNull()
  })

  test('records tab openers from the React Query projection when store branches are stale', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query')],
      currentBranch: 'feature/query',
    })

    recordWorkspacePaneTabOpener(
      { kind: 'git-branch', repoRoot: REPO_ID, branchName: 'feature/query' },
      repo.workspaceRuntimeId,
      'workspace-pane:changes',
      'workspace-pane:status',
    )

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[
        `${tabOpenerScopeKey({ kind: 'git-branch', repoRoot: REPO_ID, branchName: 'feature/query' })}\0${repo.workspaceRuntimeId}`
      ]?.['workspace-pane:changes'],
    ).toBe('workspace-pane:status')
  })

  test('scopes worktree tab openers by workspace pane target instead of branch name', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/old', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/old',
    })

    expect(
      recordWorkspacePaneTabOpener(
        {
          kind: 'git-worktree',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
        },
        repo.workspaceRuntimeId,
        'workspace-pane:changes',
        'workspace-pane:status',
      ),
    ).toBe('recorded')
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/new', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/new',
    })

    expect(workspacePaneTabOpener({
      kind: 'git-worktree',
      repoRoot: REPO_ID,
      worktreePath: WORKTREE_PATH,
    }, repo.workspaceRuntimeId, 'workspace-pane:changes')).toBe(
      'workspace-pane:status',
    )
  })

  test('keeps detached worktree openers isolated from workspace-root and branch targets', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-runtime-detached-opener')
    useReposStore.setState((state) => ({
      repos: { ...state.repos, [REPO_ID]: repo },
      order: [...state.order, REPO_ID],
      restoredRepoId: REPO_ID,
    }))
    const detachedTarget = {
      kind: 'git-worktree' as const,
      repoRoot: REPO_ID,
      worktreePath: WORKTREE_PATH,
    }
    const workspaceTarget = { kind: 'workspace-root' as const, repoRoot: REPO_ID }
    const branchTarget = { kind: 'git-branch' as const, repoRoot: REPO_ID, branchName: 'feature/query' }

    expect(
      recordWorkspacePaneTabOpener(
        detachedTarget,
        repo.workspaceRuntimeId,
        'terminal:term-111111111111111111111',
        'workspace-pane:files',
      ),
    ).toBe('recorded')
    expect(
      workspacePaneTabOpener(detachedTarget, repo.workspaceRuntimeId, 'terminal:term-111111111111111111111'),
    ).toBe('workspace-pane:files')
    expect(
      workspacePaneTabOpener(workspaceTarget, repo.workspaceRuntimeId, 'terminal:term-111111111111111111111'),
    ).toBeNull()
    expect(
      workspacePaneTabOpener(branchTarget, repo.workspaceRuntimeId, 'terminal:term-111111111111111111111'),
    ).toBeNull()
  })

  test('records against a canonical branch target without requiring a branch read model', () => {
    const repo = emptyRepo(REPO_ID, 'workspace-pane-target-repo', 'repo-runtime-workspace-pane-no-query')
    useReposStore.setState((s) => ({
      repos: { ...s.repos, [REPO_ID]: repo },
      order: [...s.order, REPO_ID],
      restoredRepoId: REPO_ID,
    }))

    expect(
      recordWorkspacePaneTabOpener(
        { kind: 'git-branch', repoRoot: REPO_ID, branchName: 'feature/query' },
        repo.workspaceRuntimeId,
        'workspace-pane:changes',
        'workspace-pane:status',
      ),
    ).toBe('recorded')
  })
})
