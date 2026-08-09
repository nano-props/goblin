import {
  createRepoBranch,
  repoPresentationFromQueryForTest,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  markRepoOperationTargets,
  nextRepoOperationId,
  repoOperation,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { runLatestOperation } from '#/web/stores/workspaces/operation-runner.ts'
import { getBranchActionCapabilities } from '#/web/hooks/useBranchActions.tsx'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import type { RepoBranchAction } from '#/web/stores/workspaces/branch-action-types.ts'
import type { BranchViewMode } from '#/shared/api-types.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { getRepoSnapshotQueryData, setRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import type { GitRemoteInfo } from '#/shared/git-types.ts'
import { repoSnapshotResponse } from '#/web/stores/workspaces/refresh-test-utils.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-client-state.test-utils.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-branch-actions-test-repo')
const REPO_WORKTREE_PATH = '/tmp/goblin-branch-actions-test-repo'
const refreshStoreAccess = { get: workspacesStore.getState, set: workspacesStore.setState }

function branchBrowserRemoteProvider(
  repo: NonNullable<ReturnType<typeof workspacesStore.getState>['workspaces'][string]>,
  branch: ReturnType<typeof createRepoBranch>,
) {
  const remote = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.remote
  if (!remote) return undefined
  const providers = remote.remoteProviders
  const tracking = branch.tracking
  if (tracking && providers) {
    const remoteName = Object.keys(providers)
      .filter((remote) => tracking === remote || tracking.startsWith(`${remote}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (remoteName) return providers[remoteName]
  }
  return remote.browserRemoteProvider
}

function testRemote(name: string): GitRemoteInfo {
  return {
    name,
    fetchUrl: `https://example.invalid/${name}/repository.git`,
    pushUrl: `https://example.invalid/${name}/repository.git`,
  }
}

function updateSnapshotForTest(mutator: (snapshot: NonNullable<ReturnType<typeof getRepoSnapshotQueryData>>) => void) {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  if (!repo) throw new Error('missing test repository')
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
  if (!snapshot) throw new Error('missing test repository snapshot')
  const next = structuredClone(snapshot)
  mutator(next)
  setRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId, next)
}

async function flushAsyncWork() {
  await waitForNextMacrotask()
}

beforeEach(() => {
  resetWorkspacesStore()
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    workspaceRuntimeId: 'repo-runtime-test',
    branches: [createRepoBranch('feature/a'), createRepoBranch('feature/b')],
  })
})

function updateRepoForTest(
  mutator: (repo: NonNullable<ReturnType<typeof workspacesStore.getState>['workspaces'][string]>) => void,
) {
  workspacesStore.setState((s) => {
    const repo = s.workspaces[REPO_ID]
    if (!repo) return s
    return { workspaces: { ...s.workspaces, [REPO_ID]: replaceWorkspace(repo, mutator) } }
  })
}

function setBranchViewModeForTest(branchViewMode: BranchViewMode) {
  workspacesStore.getState().setBranchViewMode(REPO_ID, branchViewMode)
}

function repoBranchNames(): string[] {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  return repo
    ? (getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.branches.map((branch) => branch.name) ?? [])
    : []
}

function repoCurrentBranch(): string | null {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  return repo ? (getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.current ?? null) : null
}

function repoGitPresentationForTest(
  repo: NonNullable<ReturnType<typeof workspacesStore.getState>['workspaces'][string]>,
) {
  const git = requireGitWorkspaceForTest(repo).capability.git
  return {
    ...repoPresentationFromQueryForTest(repo),
    branchAction: git.operations.branchAction,
  }
}

function createWorktreeAction(): Extract<RepoBranchAction, { kind: 'createWorktree' }> {
  return {
    kind: 'createWorktree',
    input: {
      worktreePath: '/tmp/goblin-branch-actions-test-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'feature/a' },
    },
    worktreeBootstrap: { kind: 'skip' },
  }
}

function installSuccessfulCreateWorktreeBridge(options?: { onResponse?: () => void }) {
  installGoblinTestBridge({
    'repo.createWorktree': async () => {
      options?.onResponse?.()
      return { ok: true, message: 'ok' }
    },
  })
}

describe('branch action capabilities', () => {
  test('gates remote-only actions when a repo transitions to local-only', async () => {
    const branch = createRepoBranch('feature/local', {
      worktree: { path: '/tmp/goblin-branch-actions-test-worktree', isPrimary: false, isLocked: false },
    })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: [testRemote('origin')],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    let repo = repoGitPresentationForTest(requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]))

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: true,
      canOpenTerminal: true,
      canOpenEditor: true,
    })

    updateSnapshotForTest((snapshot) => {
      const remote = snapshot.remote
      remote.remotes = []
      remote.hasRemotes = false
      remote.hasBrowserRemote = false
      remote.browserRemoteProvider = undefined
      remote.remoteProviders = {}
      remote.hasGitHubRemote = false
    })
    repo = repoGitPresentationForTest(requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]))

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: false,
      canOpenTerminal: true,
      canOpenEditor: true,
    })
  })

  test('uses canonical worktree state to gate primary worktree removal', () => {
    const branch = createRepoBranch('feature/main-worktree', {
      worktree: { path: REPO_WORKTREE_PATH, isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      branchSnapshots: [
        createBranchSnapshot('feature/main-worktree', {
          worktree: { path: REPO_WORKTREE_PATH, isPrimary: true, isLocked: false },
        }),
      ],
      currentBranch: 'main',
    })

    expect(branch.worktree).toEqual({ path: REPO_WORKTREE_PATH, isPrimary: false, isLocked: false })
    const authoritativeBranch = repoGitPresentationForTest(repo).snapshot.branches[0]!
    expect(getBranchActionCapabilities(repoGitPresentationForTest(repo), authoritativeBranch)).toMatchObject({
      canRemoveWorktree: false,
    })
  })

  test('allows removing the current branch when it belongs to a linked worktree', () => {
    const worktreePath = '/tmp/goblin-current-linked-worktree'
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/goblin-current-linked-worktree')
    const branch = createRepoBranch('feature/current-linked', {
      worktree: { path: worktreePath, isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [branch],
      currentBranch: 'feature/current-linked',
    })

    expect(getBranchActionCapabilities(repoGitPresentationForTest(repo), branch)).toMatchObject({
      canRemoveWorktree: true,
      isRegularBranch: false,
    })
  })

  test('allows terminal and editor actions for remote worktrees', async () => {
    const branch = createRepoBranch('feature/remote', {
      worktree: { path: '/srv/repo-feature', isPrimary: false, isLocked: false },
    })
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    seedRepoWithReadModelForTest({
      id: target!.id,
      branches: [branch],
      remoteLifecycle: { kind: 'ready', target: target! },
      remote: {
        remotes: [testRemote('origin')],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })

    const repo = repoGitPresentationForTest(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[target!.id]),
    )
    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canOpenTerminal: true,
      canOpenEditor: true,
    })
  })

  test('resolves browser remote providers from tracking remotes', async () => {
    const branch = createRepoBranch('feature/provider', { tracking: 'gitlab-upstream/feature/provider' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: [testRemote('origin'), testRemote('gitlab-upstream')],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github', 'gitlab-upstream': 'gitlab' },
        hasGitHubRemote: true,
      },
    })

    expect(branchBrowserRemoteProvider(workspacesStore.getState().workspaces[REPO_ID]!, branch)).toBe('gitlab')
  })

  test('falls back to the repo browser provider when tracking remote is missing', async () => {
    const branch = createRepoBranch('feature/missing-provider', { tracking: 'deleted/feature/missing-provider' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: [testRemote('origin')],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })

    expect(branchBrowserRemoteProvider(workspacesStore.getState().workspaces[REPO_ID]!, branch)).toBe('github')
  })

  test('uses the longest provider remote match for slash-containing tracking names', async () => {
    const branch = createRepoBranch('feature/longest-provider', { tracking: 'origin/gitlab/feature/longest-provider' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: [testRemote('origin'), testRemote('origin/gitlab')],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github', 'origin/gitlab': 'gitlab' },
        hasGitHubRemote: true,
      },
    })

    expect(branchBrowserRemoteProvider(workspacesStore.getState().workspaces[REPO_ID]!, branch)).toBe('gitlab')
  })
})

describe('runBranchAction', () => {
  test('blocks local branch actions while remote fetch data load is busy', async () => {
    let deleteCalls = 0
    installGoblinTestBridge({
      'repo.deleteBranch': async () => {
        deleteCalls += 1
        return { ok: true, message: 'ok' }
      },
    })
    markRepoOperationTargets(REPO_ID, nextRepoOperationId(REPO_ID), [{ key: 'fetch', reason: 'fetch' }], 'running')

    const result = await workspacesStore.getState().runBranchAction(REPO_ID, {
      kind: 'deleteBranch',
      branch: 'feature/a',
    })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(deleteCalls).toBe(0)
  })

  test('blocks branch actions while a foreground fetch is running', async () => {
    let pullCalls = 0
    let resolveFetch!: (value: { ok: true; message: string }) => void
    updateSnapshotForTest((snapshot) => {
      snapshot.remote.hasRemotes = true
    })
    installGoblinTestBridge({
      'repo.fetch': () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: true, message: 'ok' })
        }),
      'repo.pull': async () => {
        pullCalls += 1
        return { ok: true, message: 'ok' }
      },
      'repo.snapshot': async () =>
        repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    })

    const syncWork = runWorkspaceRefresh(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const result = await workspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(pullCalls).toBe(0)

    resolveFetch({ ok: true, message: 'ok' })
    await syncWork
  })

  test('tracks branch action operation state while the action is running', async () => {
    let release!: () => void
    installGoblinTestBridge({
      'repo.push': () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, message: 'cancelled' })
        }),
    })

    const work = workspacesStore.getState().runBranchAction(REPO_ID, { kind: 'push', branch: 'feature/a' })
    const running = workspacesStore.getState().workspaces[REPO_ID]

    expect(requireGitWorkspaceForTest(running).capability.git.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:push',
      target: 'feature/a',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/a')

    release()
    await work

    const settled = workspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(settled).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test('does not let an older network branch action settle a newer fetch scheduler owner', async () => {
    let resolvePull!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.pull': () =>
        new Promise((resolve) => {
          resolvePull = resolve
        }),
      'repo.snapshot': async () =>
        repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    })

    const pullWork = workspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()
    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('running')

    let releaseFetchOwner!: () => void
    const fetchOwner = runLatestOperation({
      set: workspacesStore.setState,
      get: workspacesStore.getState,
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      lane: 'read',
      operationKey: 'fetch-owner-test',
      priority: 100,
      targets: [{ key: 'fetch', reason: 'fetch' }],
      task: () =>
        new Promise<string>((resolve) => {
          releaseFetchOwner = () => resolve('fetch-owner')
        }),
    })
    await flushAsyncWork()

    resolvePull({ ok: true, message: 'ok' })
    await pullWork

    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('running')

    releaseFetchOwner()
    await fetchOwner
  })

  test('does not couple an admitted local branch action to a concurrent snapshot read', async () => {
    let deleteCalls = 0
    let resolveStatus!: (value: never[]) => void
    installGoblinTestBridge({
      'repo.snapshot': () =>
        new Promise((resolve) => {
          resolveStatus = () =>
            resolve(repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }))
        }),
      'repo.deleteBranch': async () => {
        deleteCalls += 1
        return { ok: true, message: 'ok' }
      },
    })

    const statusWork = requestRepoSnapshotRefresh(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const deleteWork = workspacesStore.getState().runBranchAction(REPO_ID, {
      kind: 'deleteBranch',
      branch: 'feature/a',
    })
    await flushAsyncWork()

    expect(deleteCalls).toBe(1)

    seedRepoWithReadModelForTest({
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      branches: [createRepoBranch('feature/reopened')],
      currentBranch: 'feature/reopened',
    })

    resolveStatus([])
    await Promise.all([statusWork, deleteWork])

    const repo = workspacesStore.getState().workspaces[REPO_ID]
    expect(deleteCalls).toBe(1)
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(requireGitWorkspaceForTest(repo).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoCurrentBranch()).toBe('feature/reopened')
  })

  test('does not make a branch action wait on an unrelated snapshot read', async () => {
    let deleteCalls = 0
    installGoblinTestBridge({
      'repo.snapshot': () => new Promise(() => {}),
      'repo.deleteBranch': async () => {
        deleteCalls += 1
        return { ok: true, message: 'ok' }
      },
    })

    void requestRepoSnapshotRefresh(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const result = await workspacesStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'deleteBranch',
        branch: 'feature/a',
      },
      { waitTimeoutMs: 1 },
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(deleteCalls).toBe(1)
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1),
    ).toMatchObject({
      kind: 'result',
      result: { ok: true, message: 'ok' },
      action: {
        kind: 'deleteBranch',
        branch: 'feature/a',
      },
    })
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction,
    ).toMatchObject({
      phase: 'idle',
      target: null,
    })
  })

  test('records network-op-in-progress results without triggering branch-action refresh follow-up', async () => {
    let snapshotCalls = 0
    let statusCalls = 0
    installGoblinTestBridge({
      'repo.pull': async () => ({ ok: false, message: 'error.network-op-in-progress' }),
      'repo.snapshot': async () => {
        snapshotCalls += 1
        statusCalls += 1
        return repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' })
      },
    })

    const result = await workspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1),
    ).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.network-op-in-progress' },
      action: {
        kind: 'pull',
        branch: 'feature/a',
      },
    })
    expect(snapshotCalls).toBe(0)
    expect(statusCalls).toBe(0)
  })

  test('clears operation phase after failed branch network actions', async () => {
    installGoblinTestBridge({
      'repo.pull': async () => ({ ok: false, message: 'boom' }),
      'repo.snapshot': async () =>
        repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    })

    const result = await workspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

    expect(result).toEqual({ ok: false, message: 'boom' })
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction,
    ).toMatchObject({
      phase: 'idle',
      target: null,
    })
  })

  test('runs branch network actions independently of snapshot reads', async () => {
    let pullCalls = 0
    let statusCalls = 0
    let resolveStatus!: (value: never[]) => void
    let resolvePull!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.snapshot': () => {
        statusCalls += 1
        if (statusCalls > 1) {
          return repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' })
        }
        return new Promise((resolve) => {
          resolveStatus = () =>
            resolve(repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }))
        })
      },
      'repo.pull': () => {
        pullCalls += 1
        return new Promise((resolve) => {
          resolvePull = () => resolve({ ok: true, message: 'ok' })
        })
      },
    })

    const statusWork = requestRepoSnapshotRefresh(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const pullWork = workspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()

    expect(pullCalls).toBe(1)
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction
        .phase,
    ).toBe('running')

    resolveStatus([])
    await flushAsyncWork()

    expect(pullCalls).toBe(1)
    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction
        .phase,
    ).toBe('running')
    resolvePull({ ok: true, message: 'ok' })
    await Promise.all([statusWork, pullWork])
  })

  test.each([
    ['createWorktree', createWorktreeAction(), 'repo.createWorktree'],
    ['deleteBranch', { kind: 'deleteBranch', branch: 'feature/a' }, 'repo.deleteBranch'],
    [
      'removeWorktree',
      {
        kind: 'removeWorktree',
        branch: 'feature/a',
        worktreePath: '/tmp/goblin-branch-actions-test-worktree',
        deleteBranch: false,
      },
      'repo.removeWorktree',
    ],
  ] satisfies Array<[string, RepoBranchAction, string]>)(
    'runs %s actions independently of snapshot reads',
    async (_label, action, ipcPath) => {
      let actionCalls = 0
      let statusCalls = 0
      let resolveStatus!: (value: never[]) => void
      let resolveAction!: (value: { ok: true; message: string }) => void
      installGoblinTestBridge({
        [ipcPath]: () => {
          actionCalls += 1
          return new Promise((resolve) => {
            resolveAction = () => resolve({ ok: true, message: 'ok' })
          })
        },
        'repo.snapshot': () => {
          statusCalls += 1
          if (statusCalls > 1) {
            return repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' })
          }
          return new Promise((resolve) => {
            resolveStatus = () =>
              resolve(repoSnapshotResponse({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }))
          })
        },
      })

      const statusWork = requestRepoSnapshotRefresh(refreshStoreAccess, REPO_ID)
      await flushAsyncWork()
      const actionWork = workspacesStore.getState().runBranchAction(REPO_ID, action)
      await flushAsyncWork()

      expect(actionCalls).toBe(1)
      expect(
        requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations
          .branchAction.phase,
      ).toBe('running')

      resolveStatus([])
      await flushAsyncWork()

      expect(actionCalls).toBe(1)
      expect(
        requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations
          .branchAction.phase,
      ).toBe('running')
      resolveAction({ ok: true, message: 'ok' })
      await Promise.all([statusWork, actionWork])
    },
  )

  test('tracks create worktree operation state while the action is running', async () => {
    let release!: () => void
    installGoblinTestBridge({
      'repo.createWorktree': () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, message: 'cancelled' })
        }),
    })

    const work = workspacesStore.getState().runBranchAction(REPO_ID, createWorktreeAction())
    const running = workspacesStore.getState().workspaces[REPO_ID]

    expect(requireGitWorkspaceForTest(running).capability.git.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:createWorktree',
      target: 'feature/new',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/new')

    release()
    await work

    const settled = workspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(settled).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test.each([
    ['createWorktree', createWorktreeAction(), 'repo.createWorktree', 'feature/new'],
    [
      'removeWorktree',
      {
        kind: 'removeWorktree',
        branch: 'feature/a',
        worktreePath: '/tmp/goblin-branch-actions-test-worktree',
        deleteBranch: false,
      },
      'repo.removeWorktree',
      'feature/a',
    ],
  ] satisfies Array<[string, RepoBranchAction, string, string]>)(
    'keeps %s busy until the mutation response arrives without replacing snapshot query data',
    async (_label, action, ipcPath, target) => {
      let resolveResponse!: () => void
      const snapshotBefore = getRepoSnapshotQueryData(REPO_ID, 'repo-runtime-test')
      installGoblinTestBridge({
        [ipcPath]: () =>
          new Promise((resolve) => {
            resolveResponse = () => resolve({ ok: true, message: 'ok' })
          }),
      })

      const work = workspacesStore.getState().runBranchAction(REPO_ID, action)
      await flushAsyncWork()

      expect(
        requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations
          .branchAction,
      ).toMatchObject({
        phase: 'running',
        target,
      })
      expect(repoOperation(REPO_ID, 'branchAction')).toMatchObject({
        phase: 'running',
        target,
      })

      resolveResponse()
      await work

      expect(
        requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.operations
          .branchAction,
      ).toMatchObject({
        phase: 'idle',
        target: null,
      })
      expect(repoOperation(REPO_ID, 'branchAction')).toMatchObject({
        phase: 'idle',
        target: null,
      })
      expect(getRepoSnapshotQueryData(REPO_ID, 'repo-runtime-test')).toBe(snapshotBefore)
    },
  )

  test('records branch action metadata on result events', async () => {
    installGoblinTestBridge({
      'repo.createWorktree': async () => ({ ok: false, message: 'error.invalid-path' }),
    })

    await workspacesStore.getState().runBranchAction(REPO_ID, createWorktreeAction(), {
      workspaceRuntimeId: 'repo-runtime-test',
    })

    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1),
    ).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.invalid-path' },
      action: {
        kind: 'createWorktree',
        branch: 'feature/new',
        worktreePath: '/tmp/goblin-branch-actions-test-worktree',
      },
    })
  })

  test('does not suppress a cancelled follow-up that carries recovery guidance', async () => {
    installGoblinTestBridge({
      'repo.createWorktree': async () => ({
        ok: false,
        message: 'cancelled',
        recoveryMessageKeys: ['error.worktree-created-followup-failed'],
      }),
    })

    await workspacesStore.getState().runBranchAction(REPO_ID, createWorktreeAction(), {
      workspaceRuntimeId: 'repo-runtime-test',
    })

    expect(
      requireGitWorkspaceForTest(workspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1),
    ).toMatchObject({
      kind: 'result',
      result: {
        ok: false,
        message: 'cancelled',
        recoveryMessageKeys: ['error.worktree-created-followup-failed'],
      },
    })
  })

  test('keeps the current branch selection after creating a worktree', async () => {
    setBranchViewModeForTest('all')
    installSuccessfulCreateWorktreeBridge()

    await workspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test' })

    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('all')
  })

  test('keeps worktrees filtering after creating a worktree', async () => {
    setBranchViewModeForTest('worktrees')
    installSuccessfulCreateWorktreeBridge()

    await workspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test' })

    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
  })

  test.each([
    ['failed', { ok: false, message: 'error.invalid-path' }],
    ['cancelled', { ok: false, message: 'cancelled' }],
  ])('keeps the current branch selection when create worktree is %s', async (_label, result) => {
    setBranchViewModeForTest('worktrees')
    installGoblinTestBridge({
      'repo.createWorktree': async () => result,
    })

    await workspacesStore.getState().runBranchAction(REPO_ID, createWorktreeAction(), {
      workspaceRuntimeId: 'repo-runtime-test',
    })

    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
  })

  test('does not let stale create worktree refresh results change selection', async () => {
    setBranchViewModeForTest('worktrees')
    installSuccessfulCreateWorktreeBridge({
      onResponse: () => {
        seedRepoWithReadModelForTest({
          id: REPO_ID,
          workspaceRuntimeId: 'repo-runtime-test-2',
          branches: [createRepoBranch('feature/a'), createRepoBranch('feature/new')],
          currentBranchName: 'feature/a',
        })
        setBranchViewModeForTest('worktrees')
      },
    })

    await workspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test' })

    const repo = workspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
  })

  test('keeps selection after non-create branch actions refresh', async () => {
    setBranchViewModeForTest('worktrees')
    installGoblinTestBridge({
      'repo.deleteBranch': async () => ({ ok: true, message: 'ok' }),
      'repo.snapshot': async () =>
        repoSnapshotResponse({
          branches: [
            createBranchSnapshot('feature/a'),
            createBranchSnapshot('feature/new', {
              worktree: { path: '/tmp/goblin-branch-actions-test-worktree', isPrimary: false, isLocked: false },
            }),
          ],
          current: 'feature/a',
        }),
    })

    await workspacesStore
      .getState()
      .runBranchAction(
        REPO_ID,
        { kind: 'deleteBranch', branch: 'feature/b', force: false },
        { workspaceRuntimeId: 'repo-runtime-test' },
      )

    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
  })
})
