import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  markRepoOperationTargets,
  nextRepoOperationId,
  repoOperation,
} from '#/web/stores/repos/repo-operation-scheduler.ts'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { getBranchActionCapabilities } from '#/web/hooks/useBranchActions.tsx'
import {
  createBranchSnapshot,
  createRepoBranch,
  installGoblinTestBridge,
  repoPresentationFromQueryForTest,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import type { RepoBranchAction } from '#/web/stores/repos/branch-action-types.ts'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { repoProjection } from '#/web/stores/repos/refresh-test-utils.ts'
const REPO_ID = '/tmp/gbl-branch-actions-test-repo'

function branchBrowserRemoteProvider(
  repo: NonNullable<ReturnType<typeof useReposStore.getState>['repos'][string]>,
  branch: ReturnType<typeof createRepoBranch>,
) {
  const providers = repo.remote.remoteProviders
  const tracking = branch.tracking
  if (tracking && providers) {
    const remoteName = Object.keys(providers)
      .filter((remote) => tracking === remote || tracking.startsWith(`${remote}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (remoteName) return providers[remoteName]
  }
  return repo.remote.browserRemoteProvider
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  resetReposStore()
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    instanceId: 'repo-instance-test',
    branches: [createRepoBranch('feature/a'), createRepoBranch('feature/b')],
  })
})

function updateRepoForTest(
  mutator: (repo: NonNullable<ReturnType<typeof useReposStore.getState>['repos'][string]>) => void,
) {
  useReposStore.setState((s) => {
    const repo = s.repos[REPO_ID]
    if (!repo) return s
    return { repos: { ...s.repos, [REPO_ID]: replaceRepo(repo, mutator) } }
  })
}

function setBranchViewModeForTest(branchViewMode: BranchViewMode) {
  updateRepoForTest((repo) => {
    repo.ui.branchViewMode = branchViewMode
  })
}

function repoBranchNames(): string[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.branches.map((branch) => branch.name) ?? []) : []
}

function repoCurrentBranch(): string | null {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.currentBranch ?? null) : null
}

function createWorktreeAction(): Extract<RepoBranchAction, { kind: 'createWorktree' }> {
  return {
    kind: 'createWorktree',
    input: {
      worktreePath: '/tmp/gbl-branch-actions-test-worktree',
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
      createBranchSnapshot('feature/new', { worktree: { path: '/tmp/gbl-branch-actions-test-worktree' } }),
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
      createBranchSnapshot('feature/a', { worktree: { path: '/tmp/gbl-branch-actions-test-repo' } }),
      createBranchSnapshot('feature/b'),
      createBranchSnapshot('feature/new', { worktree: { path: '/tmp/gbl-branch-actions-test-worktree' } }),
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
    const branch = createRepoBranch('feature/local', { worktree: { path: '/tmp/gbl-branch-actions-test-worktree' } })
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
    let repo = repoPresentationFromQueryForTest(useReposStore.getState().repos[REPO_ID]!)

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: true,
      canOpenTerminal: true,
      canOpenEditor: true,
    })

    updateRepoForTest((repo) => {
      repo.remote.remotes = []
      repo.remote.hasRemotes = false
      repo.remote.hasBrowserRemote = false
      repo.remote.browserRemoteProvider = undefined
      repo.remote.remoteProviders = {}
      repo.remote.hasGitHubRemote = false
    })
    repo = repoPresentationFromQueryForTest(useReposStore.getState().repos[REPO_ID]!)

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: false,
      canOpenTerminal: true,
      canOpenEditor: true,
    })
  })

  test('uses canonical worktree state to gate primary worktree removal', () => {
    const branch = createRepoBranch('feature/main-worktree', { worktree: { path: REPO_ID } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      branchSnapshots: [
        createBranchSnapshot('feature/main-worktree', { worktree: { path: REPO_ID, isPrimary: true } }),
      ],
      currentBranch: 'main',
    })

    expect(branch.worktree).toEqual({ path: REPO_ID })
    expect(getBranchActionCapabilities(repoPresentationFromQueryForTest(repo), branch)).toMatchObject({
      canRemoveWorktree: false,
    })
  })

  test('allows removing the current branch when it belongs to a linked worktree', () => {
    const worktreePath = '/tmp/gbl-current-linked-worktree'
    const branch = createRepoBranch('feature/current-linked', { worktree: { path: worktreePath } })
    const repo = seedRepoWithReadModelForTest({
      id: worktreePath,
      branches: [branch],
      currentBranch: 'feature/current-linked',
    })

    expect(getBranchActionCapabilities(repoPresentationFromQueryForTest(repo), branch)).toMatchObject({
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
      remote: {
        lifecycle: { kind: 'ready', target: target! },
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })

    const repo = repoPresentationFromQueryForTest(useReposStore.getState().repos[target!.id]!)
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

    expect(branchBrowserRemoteProvider(useReposStore.getState().repos[REPO_ID]!, branch)).toBe('gitlab')
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

    expect(branchBrowserRemoteProvider(useReposStore.getState().repos[REPO_ID]!, branch)).toBe('github')
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

    expect(branchBrowserRemoteProvider(useReposStore.getState().repos[REPO_ID]!, branch)).toBe('gitlab')
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

    const result = await useReposStore.getState().runBranchAction(REPO_ID, {
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
      repo.remote.hasRemotes = true
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

    const syncWork = useReposStore.getState().syncAndRefresh(REPO_ID)
    await flushAsyncWork()
    const result = await useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

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

    const work = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'push', branch: 'feature/a' })
    const running = useReposStore.getState().repos[REPO_ID]

    expect(running?.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:push',
      target: 'feature/a',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/a')

    release()
    await work

    const settled = useReposStore.getState().repos[REPO_ID]
    expect(settled?.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
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

    const statusWork = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { sections: ['status'] })
    await flushAsyncWork()
    const deleteWork = useReposStore.getState().runBranchAction(REPO_ID, {
      kind: 'deleteBranch',
      branch: 'feature/a',
    })
    await flushAsyncWork()

    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
      phase: 'queued',
      reason: 'branch:deleteBranch',
      target: 'feature/a',
    })

    seedRepoWithReadModelForTest({
      id: REPO_ID,
      instanceId: 'repo-instance-test-2',
      branches: [createRepoBranch('feature/reopened')],
      currentBranch: 'feature/reopened',
    })

    resolveStatus([])
    await Promise.all([statusWork, deleteWork])

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(deleteCalls).toBe(0)
    expect(repo?.instanceId).toBe('repo-instance-test-2')
    expect(repo?.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoCurrentBranch()).toBe('feature/reopened')
  })

  test('times out queued branch actions that wait too long for core refreshes', async () => {
    let deleteCalls = 0
    installGoblinTestBridge({
      'repo.projection': () => new Promise(() => {}),
      'repo.deleteBranch': async () => {
        deleteCalls += 1
        return { ok: true, message: 'ok' }
      },
    })

    void useReposStore.getState().refreshRuntimeProjection(REPO_ID, { sections: ['status'] })
    await flushAsyncWork()
    const result = await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'deleteBranch',
        branch: 'feature/a',
      },
      { waitTimeoutMs: 1 },
    )

    expect(result).toEqual({ ok: false, message: 'error.branch-action-wait-timeout' })
    expect(deleteCalls).toBe(0)
    expect(useReposStore.getState().repos[REPO_ID]?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.branch-action-wait-timeout' },
      action: {
        kind: 'deleteBranch',
        branch: 'feature/a',
      },
    })
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
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

    const result = await useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(useReposStore.getState().repos[REPO_ID]?.events.at(-1)).toMatchObject({
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

    const result = await useReposStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { refreshOnError: false })

    expect(result).toEqual({ ok: false, message: 'boom' })
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
  })

  test('waits for core refresh reads before running queued branch network actions', async () => {
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

    const statusWork = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { sections: ['status'] })
    await flushAsyncWork()
    const pullWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()

    expect(pullCalls).toBe(0)
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('queued')
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction.phase).toBe('queued')

    resolveStatus([])
    await flushAsyncWork()

    expect(pullCalls).toBe(1)
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction.phase).toBe('running')
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
        worktreePath: '/tmp/gbl-branch-actions-test-worktree',
        alsoDeleteBranch: false,
      },
      'repo.removeWorktree',
    ],
  ] satisfies Array<[string, RepoBranchAction, string]>)(
    'waits for core refresh reads before running queued %s actions',
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

      const statusWork = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { sections: ['status'] })
      await flushAsyncWork()
      const actionWork = useReposStore.getState().runBranchAction(REPO_ID, action)
      await flushAsyncWork()

      expect(actionCalls).toBe(0)
      expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction.phase).toBe('queued')

      resolveStatus([])
      await flushAsyncWork()

      expect(actionCalls).toBe(1)
      expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction.phase).toBe('running')
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

    const work = useReposStore.getState().runBranchAction(REPO_ID, createWorktreeAction())
    const running = useReposStore.getState().repos[REPO_ID]

    expect(running?.operations.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:createWorktree',
      target: 'feature/new',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/new')

    release()
    await work

    const settled = useReposStore.getState().repos[REPO_ID]
    expect(settled?.operations.branchAction).toMatchObject({
      phase: 'idle',
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

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

    useReposStore.getState().submitBranchAction(REPO_ID, createWorktreeAction())

    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
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

    await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId: 'repo-instance-test', refreshOnError: false })

    expect(useReposStore.getState().repos[REPO_ID]?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.invalid-path' },
      action: {
        kind: 'createWorktree',
        branch: 'feature/new',
        worktreePath: '/tmp/gbl-branch-actions-test-worktree',
      },
    })
  })

  test('keeps the current branch selection after creating a worktree', async () => {
    setBranchViewModeForTest('all')
    installSuccessfulCreateWorktreeBridge()

    await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId: 'repo-instance-test' })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('all')
  })

  test('keeps worktrees filtering after creating a worktree', async () => {
    setBranchViewModeForTest('worktrees')
    installSuccessfulCreateWorktreeBridgeWithExistingWorktree()

    await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId: 'repo-instance-test' })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
  })

  test.each([
    ['failed', { ok: false, message: 'error.invalid-path' }],
    ['cancelled', { ok: false, message: 'cancelled' }],
  ])('keeps the current branch selection when create worktree is %s', async (_label, result) => {
    setBranchViewModeForTest('worktrees')
    installGoblinTestBridge({
      'repo.createWorktree': async () => result,
    })

    await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId: 'repo-instance-test', refreshOnError: false })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
  })

  test('does not let stale create worktree refresh results change selection', async () => {
    setBranchViewModeForTest('worktrees')
    installSuccessfulCreateWorktreeBridge({
      onSnapshot: () => {
        seedRepoWithReadModelForTest({
          id: REPO_ID,
          instanceId: 'repo-instance-test-2',
          branches: [createRepoBranch('feature/a'), createRepoBranch('feature/new')],
          currentBranchName: 'feature/a',
        })
        setBranchViewModeForTest('worktrees')
      },
    })

    await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId: 'repo-instance-test' })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceId).toBe('repo-instance-test-2')
    expect(repo?.ui.branchViewMode).toBe('worktrees')
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

    const work = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      instanceId: 'repo-instance-test-2',
      branches: [createRepoBranch('feature/new-instance')],
      currentBranch: 'feature/new-instance',
    })

    resolveSnapshot()
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceId).toBe('repo-instance-test-2')
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
            createBranchSnapshot('feature/new', { worktree: { path: '/tmp/gbl-branch-actions-test-worktree' } }),
          ],
          current: 'feature/a',
        }),
    })

    await useReposStore
      .getState()
      .runBranchAction(
        REPO_ID,
        { kind: 'deleteBranch', branch: 'feature/b', force: false },
        { repoInstanceId: 'repo-instance-test' },
      )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
  })
})
