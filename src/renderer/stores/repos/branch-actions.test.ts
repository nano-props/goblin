import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { repoOperation } from '#/renderer/stores/repos/runtime.ts'
import { startResource } from '#/renderer/stores/repos/resources.ts'
import { replaceRepo } from '#/renderer/stores/repos/helpers.ts'
import { getBranchActionCapabilities } from '#/renderer/hooks/useBranchActions.tsx'
import { branchBrowserRemoteProvider } from '#/renderer/hooks/useBranchActionItems.ts'
import {
  createBranch,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/renderer/stores/repos/test-utils.ts'
import type { BranchViewMode } from '#/renderer/stores/repos/types.ts'

const REPO_ID = '/tmp/gbl-branch-actions-test-repo'

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  resetReposStore()
  seedRepoState({
    id: REPO_ID,
    instanceToken: 1,
    branches: [createBranch('feature/a'), createBranch('feature/b')],
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

function setSelectionForTest(selectedBranch: string, branchViewMode: BranchViewMode) {
  updateRepoForTest((repo) => {
    repo.ui.selectedBranch = selectedBranch
    repo.ui.branchViewMode = branchViewMode
  })
}

function installSuccessfulCreateWorktreeBridge(options?: { onSnapshot?: () => void }) {
  installGoblinTestBridge({
    'repo.createWorktree': async () => ({ ok: true, message: 'ok' }),
    'repo.snapshot': async () => {
      options?.onSnapshot?.()
      return {
        branches: [
          createBranch('feature/a'),
          createBranch('feature/b'),
          createBranch('feature/new', { worktreePath: '/tmp/gbl-branch-actions-test-worktree' }),
        ],
        current: 'feature/a',
      }
    },
    'repo.status': async () => [],
    'repo.pullRequests': async () => [],
  })
}

describe('branch action capabilities', () => {
  test('gates remote-only actions when a repo transitions to local-only', () => {
    const branch = createBranch('feature/local', { worktreePath: '/tmp/gbl-branch-actions-test-worktree' })
    seedRepoState({
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
    let repo = useReposStore.getState().repos[REPO_ID]!

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: true,
      canOpenRemote: true,
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
    repo = useReposStore.getState().repos[REPO_ID]!

    expect(getBranchActionCapabilities(repo, branch)).toMatchObject({
      canPush: false,
      canOpenRemote: false,
      canOpenTerminal: true,
      canOpenEditor: true,
    })
  })

  test('allows browser actions for non-GitHub web remotes', () => {
    const branch = createBranch('feature/gitlab')
    seedRepoState({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'gitlab',
        remoteProviders: { origin: 'gitlab' },
        hasGitHubRemote: false,
      },
    })

    expect(getBranchActionCapabilities(useReposStore.getState().repos[REPO_ID]!, branch)).toMatchObject({
      canPush: true,
      canOpenRemote: true,
    })
  })

  test('resolves browser remote providers from tracking remotes', () => {
    const branch = createBranch('feature/provider', { tracking: 'gitlab-upstream/feature/provider' })
    seedRepoState({
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
    const branch = createBranch('feature/missing-provider', { tracking: 'deleted/feature/missing-provider' })
    seedRepoState({
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
    const branch = createBranch('feature/longest-provider', { tracking: 'origin/gitlab/feature/longest-provider' })
    seedRepoState({
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
  test('blocks local branch actions while remote fetch resource is busy', async () => {
    let checkoutCalls = 0
    installGoblinTestBridge({
      'repo.checkout': async () => {
        checkoutCalls += 1
        return { ok: true, message: 'ok' }
      },
    })
    useReposStore.setState((s) => ({
      repos: {
        ...s.repos,
        [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
          startResource(repo.resources.fetch)
        }),
      },
    }))

    const result = await useReposStore.getState().runBranchAction(REPO_ID, { kind: 'checkout', branch: 'feature/a' })

    expect(result).toEqual({ ok: false, message: 'error.network-op-in-progress' })
    expect(checkoutCalls).toBe(0)
  })

  test('tracks branch action resource state while the action is running', async () => {
    let release!: () => void
    installGoblinTestBridge({
      'repo.push': () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, message: 'cancelled' })
        }),
    })

    const work = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'push', branch: 'feature/a' })
    const running = useReposStore.getState().repos[REPO_ID]

    expect(running?.resources.branchAction).toMatchObject({
      phase: 'loading',
      kind: 'push',
      target: 'feature/a',
      actionPhase: 'running',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/a')

    release()
    await work

    const settled = useReposStore.getState().repos[REPO_ID]
    expect(settled?.resources.branchAction).toMatchObject({
      phase: 'idle',
      kind: null,
      target: null,
      actionPhase: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test('queues branch network actions behind an active background fetch', async () => {
    let abortCalls = 0
    let pullCalls = 0
    let resolveFetch!: (value: { ok: false; message: string }) => void
    let resolvePull!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.abort': async () => {
        abortCalls += 1
        return true
      },
      'repo.fetch': () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: false, message: 'cancelled' })
        }),
      'repo.pull': () => {
        pullCalls += 1
        return new Promise((resolve) => {
          resolvePull = () => resolve({ ok: true, message: 'ok' })
        })
      },
      'repo.snapshot': async () => ({ branches: [createBranch('feature/a')], current: 'feature/a' }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const fetchWork = useReposStore.getState().backgroundFetch(REPO_ID)
    await flushAsyncWork()
    const pullWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

    expect(abortCalls).toBe(1)
    expect(pullCalls).toBe(0)
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('queued')
    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction).toMatchObject({
      phase: 'loading',
      kind: 'pull',
      target: 'feature/a',
      actionPhase: 'queued',
    })

    resolveFetch({ ok: false, message: 'cancelled' })
    await flushAsyncWork()

    expect(pullCalls).toBe(1)
    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction.actionPhase).toBe('running')
    resolvePull({ ok: true, message: 'ok' })
    await Promise.all([fetchWork, pullWork])
  })

  test('replaces an older queued branch network action with the latest one', async () => {
    let pullCalls = 0
    let pushCalls = 0
    let resolveFetch!: (value: { ok: false; message: string }) => void
    let resolvePush!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.abort': async () => true,
      'repo.fetch': () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: false, message: 'cancelled' })
        }),
      'repo.pull': async () => {
        pullCalls += 1
        return { ok: true, message: 'should-not-run' }
      },
      'repo.push': () => {
        pushCalls += 1
        return new Promise((resolve) => {
          resolvePush = () => resolve({ ok: true, message: 'ok' })
        })
      },
      'repo.snapshot': async () => ({
        branches: [createBranch('feature/a'), createBranch('feature/b')],
        current: 'feature/a',
      }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const fetchWork = useReposStore.getState().backgroundFetch(REPO_ID)
    await flushAsyncWork()
    const pullWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    const pushWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'push', branch: 'feature/b' })

    expect(repoOperation(REPO_ID, 'branchAction')).toMatchObject({
      phase: 'queued',
      reason: 'branch:push',
      target: 'feature/b',
    })
    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction).toMatchObject({
      phase: 'loading',
      kind: 'push',
      target: 'feature/b',
      actionPhase: 'queued',
    })

    resolveFetch({ ok: false, message: 'cancelled' })
    await flushAsyncWork()

    expect(pullCalls).toBe(0)
    expect(pushCalls).toBe(1)
    resolvePush({ ok: true, message: 'ok' })
    await Promise.all([fetchWork, pullWork, pushWork])
  })

  test('cancels a queued branch network action without running it', async () => {
    let pullCalls = 0
    let resolveFetch!: (value: { ok: false; message: string }) => void
    installGoblinTestBridge({
      'repo.abort': async () => true,
      'repo.fetch': () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: false, message: 'cancelled' })
        }),
      'repo.pull': async () => {
        pullCalls += 1
        return { ok: true, message: 'should-not-run' }
      },
      'repo.snapshot': async () => ({ branches: [createBranch('feature/a')], current: 'feature/a' }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const fetchWork = useReposStore.getState().backgroundFetch(REPO_ID)
    await flushAsyncWork()
    const pullWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })

    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('queued')
    expect(useReposStore.getState().cancelBranchAction(REPO_ID, { token: 1 })).toBe(true)
    await flushAsyncWork()

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repo?.resources.branchAction).toMatchObject({ phase: 'idle', kind: null, target: null, actionPhase: null })
    expect(repo?.resources.fetch.phase).toBe('idle')
    expect(pullCalls).toBe(0)

    resolveFetch({ ok: false, message: 'cancelled' })
    await Promise.all([fetchWork, pullWork])
    expect(pullCalls).toBe(0)
  })

  test('requests abort for a running branch network action', async () => {
    let abortCalls = 0
    let resolvePull!: (value: { ok: false; message: string }) => void
    installGoblinTestBridge({
      'repo.abort': async () => {
        abortCalls += 1
        return true
      },
      'repo.pull': () =>
        new Promise((resolve) => {
          resolvePull = () => resolve({ ok: false, message: 'cancelled' })
        }),
      'repo.snapshot': async () => ({ branches: [createBranch('feature/a')], current: 'feature/a' }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const pullWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()

    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(useReposStore.getState().cancelBranchAction(REPO_ID, { token: 1 })).toBe(true)
    expect(abortCalls).toBe(1)

    resolvePull({ ok: false, message: 'cancelled' })
    await pullWork

    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction).toMatchObject({
      phase: 'idle',
      kind: null,
      target: null,
      actionPhase: null,
    })
  })

  test('clears actionPhase after failed branch network actions', async () => {
    installGoblinTestBridge({
      'repo.pull': async () => ({ ok: false, message: 'boom' }),
      'repo.snapshot': async () => ({ branches: [createBranch('feature/a')], current: 'feature/a' }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const result = await useReposStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { refreshOnError: false })

    expect(result).toEqual({ ok: false, message: 'boom' })
    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction).toMatchObject({
      phase: 'idle',
      kind: null,
      target: null,
      actionPhase: null,
    })
  })

  test('clears stale branch network action resources when a queued action is replaced', async () => {
    let resolveFetch!: (value: { ok: false; message: string }) => void
    let resolvePush!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.abort': async () => true,
      'repo.fetch': () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: false, message: 'cancelled' })
        }),
      'repo.pull': async () => ({ ok: true, message: 'should-not-run' }),
      'repo.push': () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ ok: true, message: 'ok' })
        }),
      'repo.snapshot': async () => ({
        branches: [createBranch('feature/a'), createBranch('feature/b')],
        current: 'feature/a',
      }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const fetchWork = useReposStore.getState().backgroundFetch(REPO_ID)
    await flushAsyncWork()
    const pullWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    const pushWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'push', branch: 'feature/b' })

    resolveFetch({ ok: false, message: 'cancelled' })
    await flushAsyncWork()
    resolvePush({ ok: true, message: 'ok' })
    await Promise.all([fetchWork, pullWork, pushWork])

    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction).toMatchObject({
      phase: 'idle',
      kind: null,
      target: null,
      actionPhase: null,
    })
  })

  test('waits for core refresh reads before running queued branch network actions', async () => {
    let pullCalls = 0
    let statusCalls = 0
    let resolveStatus!: (value: never[]) => void
    let resolvePull!: (value: { ok: true; message: string }) => void
    installGoblinTestBridge({
      'repo.status': () => {
        statusCalls += 1
        if (statusCalls > 1) return []
        return new Promise((resolve) => {
          resolveStatus = () => resolve([])
        })
      },
      'repo.pull': () => {
        pullCalls += 1
        return new Promise((resolve) => {
          resolvePull = () => resolve({ ok: true, message: 'ok' })
        })
      },
      'repo.snapshot': async () => ({ branches: [createBranch('feature/a')], current: 'feature/a' }),
      'repo.pullRequests': async () => [],
    })

    const statusWork = useReposStore.getState().refreshStatus(REPO_ID)
    await flushAsyncWork()
    const pullWork = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()

    expect(pullCalls).toBe(0)
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction.actionPhase).toBe('queued')

    resolveStatus([])
    await flushAsyncWork()

    expect(pullCalls).toBe(1)
    expect(useReposStore.getState().repos[REPO_ID]?.resources.branchAction.actionPhase).toBe('running')
    resolvePull({ ok: true, message: 'ok' })
    await Promise.all([statusWork, pullWork])
  })

  test('tracks create worktree resource state while the action is running', async () => {
    let release!: () => void
    installGoblinTestBridge({
      'repo.createWorktree': () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, message: 'cancelled' })
        }),
    })

    const work = useReposStore.getState().runBranchAction(REPO_ID, {
      kind: 'createWorktree',
      worktreePath: '/tmp/gbl-branch-actions-test-worktree',
      newBranch: 'feature/new',
      baseBranch: 'feature/a',
    })
    const running = useReposStore.getState().repos[REPO_ID]

    expect(running?.resources.branchAction).toMatchObject({
      phase: 'loading',
      kind: 'createWorktree',
      target: 'feature/new',
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('running')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBe('feature/new')

    release()
    await work

    const settled = useReposStore.getState().repos[REPO_ID]
    expect(settled?.resources.branchAction).toMatchObject({
      phase: 'idle',
      kind: null,
      target: null,
    })
    expect(repoOperation(REPO_ID, 'branchAction').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'branchAction').target).toBeNull()
  })

  test('records branch action metadata on result events', async () => {
    installGoblinTestBridge({
      'repo.createWorktree': async () => ({ ok: false, message: 'error.invalid-path' }),
    })

    await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        worktreePath: '/tmp/gbl-branch-actions-test-worktree',
        newBranch: 'feature/new',
        baseBranch: 'feature/a',
      },
      { token: 1, refreshOnError: false },
    )

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
    setSelectionForTest('feature/a', 'all')
    installSuccessfulCreateWorktreeBridge()

    await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        worktreePath: '/tmp/gbl-branch-actions-test-worktree',
        newBranch: 'feature/new',
        baseBranch: 'feature/a',
      },
      { token: 1 },
    )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('all')
    expect(repo?.ui.selectedBranch).toBe('feature/a')
  })

  test('keeps no-worktree filtering after creating a worktree', async () => {
    setSelectionForTest('feature/a', 'no-worktree')
    installSuccessfulCreateWorktreeBridge()

    await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        worktreePath: '/tmp/gbl-branch-actions-test-worktree',
        newBranch: 'feature/new',
        baseBranch: 'feature/a',
      },
      { token: 1 },
    )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('no-worktree')
    expect(repo?.ui.selectedBranch).toBe('feature/a')
  })

  test.each([
    ['failed', { ok: false, message: 'error.invalid-path' }],
    ['cancelled', { ok: false, message: 'cancelled' }],
  ])('keeps the current branch selection when create worktree is %s', async (_label, result) => {
    setSelectionForTest('feature/a', 'no-worktree')
    installGoblinTestBridge({
      'repo.createWorktree': async () => result,
    })

    await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        worktreePath: '/tmp/gbl-branch-actions-test-worktree',
        newBranch: 'feature/new',
        baseBranch: 'feature/a',
      },
      { token: 1, refreshOnError: false },
    )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('no-worktree')
    expect(repo?.ui.selectedBranch).toBe('feature/a')
  })

  test('does not let stale create worktree refresh results change selection', async () => {
    setSelectionForTest('feature/a', 'no-worktree')
    installSuccessfulCreateWorktreeBridge({
      onSnapshot: () => {
        seedRepoState({
          id: REPO_ID,
          instanceToken: 2,
          branches: [createBranch('feature/a'), createBranch('feature/new')],
          selectedBranch: 'feature/a',
        })
        setSelectionForTest('feature/a', 'no-worktree')
      },
    })

    await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        worktreePath: '/tmp/gbl-branch-actions-test-worktree',
        newBranch: 'feature/new',
        baseBranch: 'feature/a',
      },
      { token: 1 },
    )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.ui.branchViewMode).toBe('no-worktree')
    expect(repo?.ui.selectedBranch).toBe('feature/a')
  })

  test('does not let stale branch action refresh results overwrite a reopened repo', async () => {
    let resolveSnapshot!: () => void
    installGoblinTestBridge({
      'repo.pull': async () => ({ ok: true, message: 'ok' }),
      'repo.snapshot': () =>
        new Promise((resolve) => {
          resolveSnapshot = () => resolve({ branches: [createBranch('feature/stale')], current: 'feature/stale' })
        }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    const work = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' })
    await flushAsyncWork()
    seedRepoState({
      id: REPO_ID,
      instanceToken: 2,
      branches: [createBranch('feature/new-instance')],
      currentBranch: 'feature/new-instance',
    })

    resolveSnapshot()
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.data.currentBranch).toBe('feature/new-instance')
    expect(repo?.data.branches.map((branch) => branch.name)).toEqual(['feature/new-instance'])
  })

  test('keeps selection after non-create branch actions refresh', async () => {
    setSelectionForTest('feature/a', 'no-worktree')
    installGoblinTestBridge({
      'repo.deleteBranch': async () => ({ ok: true, message: 'ok' }),
      'repo.snapshot': async () => ({
        branches: [
          createBranch('feature/a'),
          createBranch('feature/new', { worktreePath: '/tmp/gbl-branch-actions-test-worktree' }),
        ],
        current: 'feature/a',
      }),
      'repo.status': async () => [],
      'repo.pullRequests': async () => [],
    })

    await useReposStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'deleteBranch', branch: 'feature/b', force: false }, { token: 1 })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('no-worktree')
    expect(repo?.ui.selectedBranch).toBe('feature/a')
  })
})
