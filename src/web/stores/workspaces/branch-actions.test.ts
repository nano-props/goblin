import { beforeEach, describe, expect, test } from 'vitest'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  markRepoOperationTargets,
  nextRepoOperationId,
  repoOperation,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { requestRepoProjectionReadModelRefresh, runManualRepoSync } from '#/web/stores/workspaces/refresh.ts'
import { replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { runLatestOperation } from '#/web/stores/workspaces/operation-runner.ts'
import { getBranchActionCapabilities } from '#/web/hooks/useBranchActions.tsx'
import {
  createBranchSnapshot,
  createRepoBranch,
  installGoblinTestBridge,
  repoPresentationFromQueryForTest,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import type { RepoBranchAction } from '#/web/stores/workspaces/branch-action-types.ts'
import type { BranchViewMode } from '#/web/stores/workspaces/types.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { repoProjection } from '#/web/stores/workspaces/refresh-test-utils.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-branch-actions-test-repo')
const REPO_WORKTREE_PATH = '/tmp/goblin-branch-actions-test-repo'
const refreshStoreAccess = { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState }

function branchBrowserRemoteProvider(
  repo: NonNullable<ReturnType<typeof useWorkspacesStore.getState>['workspaces'][string]>,
  branch: ReturnType<typeof createRepoBranch>,
) {
  const remote = requireGitWorkspaceForTest(repo).capability.git.remote
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

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
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
  mutator: (repo: NonNullable<ReturnType<typeof useWorkspacesStore.getState>['workspaces'][string]>) => void,
) {
  useWorkspacesStore.setState((s) => {
    const repo = s.workspaces[REPO_ID]
    if (!repo) return s
    return { workspaces: { ...s.workspaces, [REPO_ID]: replaceWorkspace(repo, mutator) } }
  })
}

function setBranchViewModeForTest(branchViewMode: BranchViewMode) {
  updateRepoForTest((repo) => {
    requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode = branchViewMode
  })
}

function repoBranchNames(): string[] {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.branches.map((branch) => branch.name) ?? []) : []
}

function repoCurrentBranch(): string | null {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.currentBranch ?? null) : null
}

function repoGitPresentationForTest(repo: NonNullable<ReturnType<typeof useWorkspacesStore.getState>['workspaces'][string]>) {
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

function installSuccessfulCreateWorktreeBridge(options?: { onSnapshot?: () => void }) {
  const snapshot = {
    branches: [
      createBranchSnapshot('feature/a'),
      createBranchSnapshot('feature/b'),
      createBranchSnapshot('feature/new', { worktree: { path: '/tmp/goblin-branch-actions-test-worktree' } }),
    ],
    current: 'feature/a',
  }
  installGoblinTestBridge({
    'repo.createWorktree': async () => ({ ok: true, message: 'ok' }),
    'repo.projection': async () => {
      options?.onSnapshot?.()
      return repoProjection(snapshot)
    },
  })
}

function installSuccessfulCreateWorktreeBridgeWithExistingWorktree(options?: { onSnapshot?: () => void }) {
  const snapshot = {
    branches: [
      createBranchSnapshot('feature/a', { worktree: { path: '/tmp/goblin-branch-actions-test-repo' } }),
      createBranchSnapshot('feature/b'),
      createBranchSnapshot('feature/new', { worktree: { path: '/tmp/goblin-branch-actions-test-worktree' } }),
    ],
    current: 'feature/a',
  }
  installGoblinTestBridge({
    'repo.createWorktree': async () => ({ ok: true, message: 'ok' }),
    'repo.projection': async () => {
      options?.onSnapshot?.()
      return repoProjection(snapshot)
    },
  })
}

describe('branch action capabilities', () => {
  test('gates remote-only actions when a repo transitions to local-only', () => {
    const branch = createRepoBranch('feature/local', { worktree: { path: '/tmp/goblin-branch-actions-test-worktree' } })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    let repo = repoGitPresentationForTest(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]))

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: true,
      canOpenTerminal: true,
      canOpenEditor: true,
    })

    updateRepoForTest((repo) => {
      const remote = requireGitWorkspaceForTest(repo).capability.git.remote
      remote.remotes = []
      remote.hasRemotes = false
      remote.hasBrowserRemote = false
      remote.browserRemoteProvider = undefined
      remote.remoteProviders = {}
      remote.hasGitHubRemote = false
    })
    repo = repoGitPresentationForTest(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]))

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: false,
      canOpenTerminal: true,
      canOpenEditor: true,
    })
  })

  test('uses canonical worktree state to gate primary worktree removal', () => {
    const branch = createRepoBranch('feature/main-worktree', { worktree: { path: REPO_WORKTREE_PATH } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      branchSnapshots: [
        createBranchSnapshot('feature/main-worktree', { worktree: { path: REPO_WORKTREE_PATH, isPrimary: true } }),
      ],
      currentBranch: 'main',
    })

    expect(branch.worktree).toEqual({ path: REPO_WORKTREE_PATH })
    expect(getBranchActionCapabilities(repoGitPresentationForTest(repo), branch)).toMatchObject({
      canRemoveWorktree: false,
    })
  })

  test('allows removing the current branch when it belongs to a linked worktree', () => {
    const worktreePath = '/tmp/goblin-current-linked-worktree'
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/goblin-current-linked-worktree')
    const branch = createRepoBranch('feature/current-linked', { worktree: { path: worktreePath } })
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

  test('allows terminal and editor actions for remote worktrees', () => {
    const branch = createRepoBranch('feature/remote', { worktree: { path: '/srv/repo-feature' } })
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
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })

    const repo = repoGitPresentationForTest(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[target!.id]))
    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canOpenTerminal: true,
      canOpenEditor: true,
    })
  })

  test('resolves browser remote providers from tracking remotes', () => {
    const branch = createRepoBranch('feature/provider', { tracking: 'gitlab-upstream/feature/provider' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: ['origin', 'gitlab-upstream'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github', 'gitlab-upstream': 'gitlab' },
        hasGitHubRemote: true,
      },
    })

    expect(branchBrowserRemoteProvider(useWorkspacesStore.getState().workspaces[REPO_ID]!, branch)).toBe('gitlab')
  })

  test('falls back to the repo browser provider when tracking remote is missing', () => {
    const branch = createRepoBranch('feature/missing-provider', { tracking: 'deleted/feature/missing-provider' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })

    expect(branchBrowserRemoteProvider(useWorkspacesStore.getState().workspaces[REPO_ID]!, branch)).toBe('github')
  })

  test('uses the longest provider remote match for slash-containing tracking names', () => {
    const branch = createRepoBranch('feature/longest-provider', { tracking: 'origin/gitlab/feature/longest-provider' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: ['origin', 'origin/gitlab'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github', 'origin/gitlab': 'gitlab' },
        hasGitHubRemote: true,
      },
    })

    expect(branchBrowserRemoteProvider(useWorkspacesStore.getState().workspaces[REPO_ID]!, branch)).toBe('gitlab')
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

    const result = await useWorkspacesStore.getState().runBranchAction(REPO_ID, {
      kind: 'deleteBranch',
      branch: 'feature/a',
    })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(deleteCalls).toBe(0)
  })

  test('blocks branch actions while a foreground fetch is running', async () => {
    let pullCalls = 0
    let resolveFetch!: (value: { ok: true; message: string }) => void
    updateRepoForTest((repo) => {
      requireGitWorkspaceForTest(repo).capability.git.remote.hasRemotes = true
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
      'repo.projection': async () =>
        repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    })

    const syncWork = runManualRepoSync(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const result = await useWorkspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

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

    const work = useWorkspacesStore.getState().runBranchAction(REPO_ID, { kind: 'push', branch: 'feature/a' })
    const running = useWorkspacesStore.getState().workspaces[REPO_ID]

    expect(requireGitWorkspaceForTest(running).capability.git.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:push',
      target: 'feature/a',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/a')

    release()
    await work

    const settled = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(settled).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test('does not let an older network branch action settle a newer fetch data load owner', async () => {
    let resolvePull!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.pull': () =>
        new Promise((resolve) => {
          resolvePull = resolve
        }),
      'repo.projection': async () =>
        repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    })

    const pullWork = useWorkspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()
    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.dataLoads.fetch.phase).toBe('loading')

    let releaseFetchOwner!: () => void
    const fetchOwner = runLatestOperation({
      set: useWorkspacesStore.setState,
      get: useWorkspacesStore.getState,
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

    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.dataLoads.fetch.phase).toBe('loading')
    expect(repoOperation(REPO_ID, 'fetch').phase).toBe('running')

    releaseFetchOwner()
    await fetchOwner
  })

  test('does not run a queued local branch action after the repo is reopened', async () => {
    let deleteCalls = 0
    let resolveStatus!: (value: never[]) => void
    installGoblinTestBridge({
      'repo.projection': () =>
        new Promise((resolve) => {
          resolveStatus = () =>
            resolve(repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }))
        }),
      'repo.deleteBranch': async () => {
        deleteCalls += 1
        return { ok: true, message: 'ok' }
      },
    })

    const statusWork = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const deleteWork = useWorkspacesStore.getState().runBranchAction(REPO_ID, {
      kind: 'deleteBranch',
      branch: 'feature/a',
    })
    await flushAsyncWork()

    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction).toMatchObject({
      phase: 'queued',
      reason: 'branch:deleteBranch',
      target: 'feature/a',
    })

    seedRepoWithReadModelForTest({
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      branches: [createRepoBranch('feature/reopened')],
      currentBranch: 'feature/reopened',
    })

    resolveStatus([])
    await Promise.all([statusWork, deleteWork])

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(deleteCalls).toBe(0)
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(requireGitWorkspaceForTest(repo).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoCurrentBranch()).toBe('feature/reopened')
  })

  test('times out queued branch actions that wait too long for projection reads', async () => {
    let deleteCalls = 0
    installGoblinTestBridge({
      'repo.projection': () => new Promise(() => {}),
      'repo.deleteBranch': async () => {
        deleteCalls += 1
        return { ok: true, message: 'ok' }
      },
    })

    void requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const result = await useWorkspacesStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'deleteBranch',
        branch: 'feature/a',
      },
      { waitTimeoutMs: 1 },
    )

    expect(result).toEqual({ ok: false, message: 'error.branch-action-wait-timeout' })
    expect(deleteCalls).toBe(0)
    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.branch-action-wait-timeout' },
      action: {
        kind: 'deleteBranch',
        branch: 'feature/a',
      },
    })
    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
  })

  test('records network-op-in-progress results without triggering branch-action refresh follow-up', async () => {
    let snapshotCalls = 0
    let statusCalls = 0
    installGoblinTestBridge({
      'repo.pull': async () => ({ ok: false, message: 'error.network-op-in-progress' }),
      'repo.projection': async () => {
        snapshotCalls += 1
        statusCalls += 1
        return repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' })
      },
    })

    const result = await useWorkspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1)).toMatchObject({
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
      'repo.projection': async () =>
        repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    })

    const result = await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { refreshOnError: false })

    expect(result).toEqual({ ok: false, message: 'boom' })
    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
  })

  test('waits for projection reads before running queued branch network actions', async () => {
    let pullCalls = 0
    let statusCalls = 0
    let resolveStatus!: (value: never[]) => void
    let resolvePull!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.projection': () => {
        statusCalls += 1
        if (statusCalls > 1) {
          return repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' })
        }
        return new Promise((resolve) => {
          resolveStatus = () =>
            resolve(repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }))
        })
      },
      'repo.pull': () => {
        pullCalls += 1
        return new Promise((resolve) => {
          resolvePull = () => resolve({ ok: true, message: 'ok' })
        })
      },
    })

    const statusWork = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID)
    await flushAsyncWork()
    const pullWork = useWorkspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()

    expect(pullCalls).toBe(0)
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('queued')
    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction.phase).toBe('queued')

    resolveStatus([])
    await flushAsyncWork()

    expect(pullCalls).toBe(1)
    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction.phase).toBe('running')
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
    'waits for projection reads before running queued %s actions',
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
        'repo.projection': () => {
          statusCalls += 1
          if (statusCalls > 1) {
            return repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' })
          }
          return new Promise((resolve) => {
            resolveStatus = () =>
              resolve(repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }))
          })
        },
      })

      const statusWork = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID)
      await flushAsyncWork()
      const actionWork = useWorkspacesStore.getState().runBranchAction(REPO_ID, action)
      await flushAsyncWork()

      expect(actionCalls).toBe(0)
      expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction.phase).toBe('queued')

      resolveStatus([])
      await flushAsyncWork()

      expect(actionCalls).toBe(1)
      expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction.phase).toBe('running')
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

    const work = useWorkspacesStore.getState().runBranchAction(REPO_ID, createWorktreeAction())
    const running = useWorkspacesStore.getState().workspaces[REPO_ID]

    expect(requireGitWorkspaceForTest(running).capability.git.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:createWorktree',
      target: 'feature/new',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/new')

    release()
    await work

    const settled = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(settled).capability.git.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test.each([
    [
      'createWorktree',
      createWorktreeAction(),
      'repo.createWorktree',
      'feature/new',
      repoProjection({
        branches: [
          createBranchSnapshot('feature/a'),
          createBranchSnapshot('feature/new', { worktree: { path: '/tmp/goblin-branch-actions-test-worktree' } }),
        ],
        current: 'feature/a',
      }),
    ],
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
      repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    ],
  ] satisfies Array<[string, RepoBranchAction, string, string, ReturnType<typeof repoProjection>]>)(
    'keeps %s busy until the follow-up projection refresh completes',
    async (_label, action, ipcPath, target, projection) => {
      let resolveProjection!: () => void
      installGoblinTestBridge({
        [ipcPath]: async () => ({ ok: true, message: 'ok' }),
        'repo.projection': () =>
          new Promise((resolve) => {
            resolveProjection = () => resolve(projection)
          }),
      })

      const work = useWorkspacesStore.getState().runBranchAction(REPO_ID, action)
      await flushAsyncWork()

      expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction).toMatchObject({
        phase: 'running',
        target,
      })
      expect(repoOperation(REPO_ID, 'branchAction')).toMatchObject({
        phase: 'running',
        target,
      })

      resolveProjection()
      await work

      expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction).toMatchObject({
        phase: 'idle',
        target: null,
      })
      expect(repoOperation(REPO_ID, 'branchAction')).toMatchObject({
        phase: 'idle',
        target: null,
      })
    },
  )

  test('submitBranchAction starts create worktree without waiting for completion', async () => {
    let release!: () => void
    installGoblinTestBridge({
      'repo.createWorktree': () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, message: 'ok' })
        }),
      'repo.projection': async () =>
        repoProjection({ branches: [createBranchSnapshot('feature/a')], current: 'feature/a' }),
    })

    useWorkspacesStore.getState().submitBranchAction(REPO_ID, createWorktreeAction())

    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:createWorktree',
      target: 'feature/new',
    })

    release()
    await flushAsyncWork()
  })

  test('records branch action metadata on result events', async () => {
    installGoblinTestBridge({
      'repo.createWorktree': async () => ({ ok: false, message: 'error.invalid-path' }),
    })

    await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test', refreshOnError: false })

    expect(requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.invalid-path' },
      action: {
        kind: 'createWorktree',
        branch: 'feature/new',
        worktreePath: '/tmp/goblin-branch-actions-test-worktree',
      },
    })
  })

  test('keeps the current branch selection after creating a worktree', async () => {
    setBranchViewModeForTest('all')
    installSuccessfulCreateWorktreeBridge()

    await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test' })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('all')
  })

  test('keeps worktrees filtering after creating a worktree', async () => {
    setBranchViewModeForTest('worktrees')
    installSuccessfulCreateWorktreeBridgeWithExistingWorktree()

    await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test' })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('worktrees')
  })

  test.each([
    ['failed', { ok: false, message: 'error.invalid-path' }],
    ['cancelled', { ok: false, message: 'cancelled' }],
  ])('keeps the current branch selection when create worktree is %s', async (_label, result) => {
    setBranchViewModeForTest('worktrees')
    installGoblinTestBridge({
      'repo.createWorktree': async () => result,
    })

    await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test', refreshOnError: false })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('worktrees')
  })

  test('does not let stale create worktree refresh results change selection', async () => {
    setBranchViewModeForTest('worktrees')
    installSuccessfulCreateWorktreeBridge({
      onSnapshot: () => {
        seedRepoWithReadModelForTest({
          id: REPO_ID,
          workspaceRuntimeId: 'repo-runtime-test-2',
          branches: [createRepoBranch('feature/a'), createRepoBranch('feature/new')],
          currentBranchName: 'feature/a',
        })
        setBranchViewModeForTest('worktrees')
      },
    })

    await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId: 'repo-runtime-test' })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('worktrees')
  })

  test('does not let stale branch action refresh results overwrite a reopened repo', async () => {
    let resolveSnapshot!: () => void
    installGoblinTestBridge({
      'repo.pull': async () => ({ ok: true, message: 'ok' }),
      'repo.projection': () =>
        new Promise((resolve) => {
          resolveSnapshot = () =>
            resolve(repoProjection({ branches: [createBranchSnapshot('feature/stale')], current: 'feature/stale' }))
        }),
    })

    const work = useWorkspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      branches: [createRepoBranch('feature/new-instance')],
      currentBranch: 'feature/new-instance',
    })

    resolveSnapshot()
    await work

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(repoCurrentBranch()).toBe('feature/new-instance')
    expect(repoBranchNames()).toEqual(['feature/new-instance'])
  })

  test('keeps selection after non-create branch actions refresh', async () => {
    setBranchViewModeForTest('worktrees')
    installGoblinTestBridge({
      'repo.deleteBranch': async () => ({ ok: true, message: 'ok' }),
      'repo.projection': async () =>
        repoProjection({
          branches: [
            createBranchSnapshot('feature/a'),
            createBranchSnapshot('feature/new', { worktree: { path: '/tmp/goblin-branch-actions-test-worktree' } }),
          ],
          current: 'feature/a',
        }),
    })

    await useWorkspacesStore
      .getState()
      .runBranchAction(
        REPO_ID,
        { kind: 'deleteBranch', branch: 'feature/b', force: false },
        { workspaceRuntimeId: 'repo-runtime-test' },
      )

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('worktrees')
  })
})
