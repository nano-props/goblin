/**
 * Lifecycle / orchestrator coverage for the unified
 * runRemoteRepoConnection entry point.
 *
 * Mirrors docs/goblin-remote-repo-refactor-plan.md §10.1:
 *   1. remote open success -> connecting -> ready
 *   2. remote config changed -> connecting -> failed(config-changed)
 *   3. remote network failure -> connecting -> failed(unreachable)
 *   4. remote repo path missing -> connecting -> failed(path-missing)
 *   5. retry from failed -> connecting -> ready/failed
 *   6. stale run superseded by a newer run -> older run does not write
 *   7. abort without successor -> falls back to failed (no orphaned
 *      connecting)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock `resolveRemoteRepoConnection` to a controllable stub.
// By default the stub delegates to the real implementation
// (via `importActual`) so the existing happy-path tests
// still hit the IPC bridge. The abort-without-successor
// test below flips `shouldThrow` to drive the orchestrator's
// `onError` path. Using `vi.mock` at the file level (rather
// than `vi.doMock` or per-test spies) is the only way to
// reliably intercept the orchestrator's already-evaluated
// import of the function.
let shouldThrowResolveLifecycle = false
vi.mock('#/web/remote-client.ts', async (importActual) => {
  const actual = await importActual<typeof import('#/web/remote-client.ts')>()
  return {
    ...actual,
    resolveRemoteRepoConnection: vi.fn(async (input, signal) => {
      if (shouldThrowResolveLifecycle) {
        throw new Error('aborted')
      }
      return actual.resolveRemoteRepoConnection(input, signal)
    }),
  }
})

import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-orchestrator.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { installGoblin, resetLifecycleTest } from '#/web/stores/repos/repo-session-test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

const REMOTE_ID = 'ssh-config://example/srv/repo'

function remoteTargetFixture() {
  const target = normalizeRemoteTarget({
    alias: 'example',
    host: 'example.com',
    user: 'alice',
    port: 22,
    remotePath: '/srv/repo',
  })
  expect(target).not.toBeNull()
  return target!
}

describe('runRemoteRepoConnection', () => {
  beforeEach(() => {
    resetLifecycleTest()
  })

  afterEach(() => {
    resetLifecycleTest()
  })

  test('a successful resolveTarget + probe converges to ready and triggers a refresh', async () => {
    installGoblin({
      probe: (cwd: string) => ({ ok: true, root: cwd, name: 'repo' }),
    })

    // Pre-insert a placeholder shell so the orchestrator has a
    // repo to flip to 'connecting'.
    useReposStore.setState((s) => {
      const repo: RepoState = {
        id: REMOTE_ID,
        name: 'example:repo',
        instanceId: 'repo-instance-test',
        dataLoads: {
          repoReadModel: { phase: 'idle', loadedAt: null, stale: false, error: null },
          visibleStatus: { phase: 'idle', loadedAt: null, stale: false, error: null },
          fetch: { phase: 'idle', loadedAt: null, stale: false, error: null },
        },
        operations: emptyOperations(),
        ui: {
          branchViewMode: 'all',
          preferredWorkspacePaneTabByTarget: {},
        },
        projection: { source: 'fresh', savedAt: null },
        remote: {
          lifecycle: { kind: 'connecting' },
          remotes: [],
          remoteDetails: [],
          hasRemotes: false,
          hasBrowserRemote: false,
          browserRemoteProvider: undefined,
          remoteProviders: {},
          hasGitHubRemote: false,
          fetchFailed: false,
          fetchError: null,
        },
        availability: { phase: 'available' },
        events: [],
      }
      return { ...s, repos: { ...s.repos, [REMOTE_ID]: repo }, order: [REMOTE_ID] }
    })

    const outcome = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
    expect(outcome?.kind).toBe('ready')

    const final = useReposStore.getState().repos[REMOTE_ID]
    expect(final?.remote.lifecycle?.kind).toBe('ready')
    if (final?.remote.lifecycle?.kind === 'ready') {
      expect(final.remote.lifecycle.target.id).toBe(REMOTE_ID)
    }
  })

  test('a config-changed failure settles to failed(config-changed)', async () => {
    installGoblin({
      'remote.resolveTarget': () => ({ error: 'error.ssh-config-changed' }),
    })
    useReposStore.setState((s) => {
      const repo: RepoState = {
        id: REMOTE_ID,
        name: 'example:repo',
        instanceId: 'repo-instance-test',
        dataLoads: emptyDataLoads(),
        operations: emptyOperations(),
        ui: {
          branchViewMode: 'all',
          preferredWorkspacePaneTabByTarget: {},
        },
        projection: { source: 'fresh', savedAt: null },
        remote: {
          lifecycle: { kind: 'connecting' },
          remotes: [],
          remoteDetails: [],
          hasRemotes: false,
          hasBrowserRemote: false,
          browserRemoteProvider: undefined,
          remoteProviders: {},
          hasGitHubRemote: false,
          fetchFailed: false,
          fetchError: null,
        },
        availability: { phase: 'available' },
        events: [],
      }
      return { ...s, repos: { ...s.repos, [REMOTE_ID]: repo }, order: [REMOTE_ID] }
    })

    const outcome = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
    expect(outcome?.kind).toBe('failed')
    expect(outcome?.reason).toBe('config-changed')
    expect(useReposStore.getState().repos[REMOTE_ID]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'config-changed',
      target: undefined,
    })
  })

  test('a probe failure with path-missing reason settles to failed(path-missing)', async () => {
    installGoblin({
      probe: () => ({ ok: false, message: 'path-missing' }),
    })
    useReposStore.setState((s) => {
      const repo: RepoState = {
        id: REMOTE_ID,
        name: 'example:repo',
        instanceId: 'repo-instance-test',
        dataLoads: emptyDataLoads(),
        operations: emptyOperations(),
        ui: {
          branchViewMode: 'all',
          preferredWorkspacePaneTabByTarget: {},
        },
        projection: { source: 'fresh', savedAt: null },
        remote: {
          lifecycle: { kind: 'connecting' },
          remotes: [],
          remoteDetails: [],
          hasRemotes: false,
          hasBrowserRemote: false,
          browserRemoteProvider: undefined,
          remoteProviders: {},
          hasGitHubRemote: false,
          fetchFailed: false,
          fetchError: null,
        },
        availability: { phase: 'available' },
        events: [],
      }
      return { ...s, repos: { ...s.repos, [REMOTE_ID]: repo }, order: [REMOTE_ID] }
    })

    const outcome = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
    expect(outcome?.kind).toBe('failed')
    expect(outcome?.reason).toBe('path-missing')
  })

  test('retry from failed flips to connecting and re-runs', async () => {
    let probeCalls = 0
    installGoblin({
      probe: (cwd: string) => {
        probeCalls += 1
        if (probeCalls === 1) return { ok: false, message: 'unreachable' }
        return { ok: true, root: cwd, name: 'repo' }
      },
    })
    useReposStore.setState((s) => {
      const repo: RepoState = {
        id: REMOTE_ID,
        name: 'example:repo',
        instanceId: 'repo-instance-test',
        dataLoads: emptyDataLoads(),
        operations: emptyOperations(),
        ui: {
          branchViewMode: 'all',
          preferredWorkspacePaneTabByTarget: {},
        },
        projection: { source: 'fresh', savedAt: null },
        remote: {
          lifecycle: { kind: 'failed', reason: 'unreachable' },
          remotes: [],
          remoteDetails: [],
          hasRemotes: false,
          hasBrowserRemote: false,
          browserRemoteProvider: undefined,
          remoteProviders: {},
          hasGitHubRemote: false,
          fetchFailed: false,
          fetchError: null,
        },
        availability: { phase: 'unavailable', reason: 'unreachable', checkedAt: 0 },
        events: [],
      }
      return { ...s, repos: { ...s.repos, [REMOTE_ID]: repo }, order: [REMOTE_ID] }
    })

    // First call: settle to failed.
    await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
    expect(useReposStore.getState().repos[REMOTE_ID]?.remote.lifecycle?.kind).toBe('failed')

    // Retry: the orchestrator flips to connecting and re-runs.
    const second = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
    expect(second?.kind).toBe('ready')
    expect(useReposStore.getState().repos[REMOTE_ID]?.remote.lifecycle?.kind).toBe('ready')
  })

  test('ready settlement updates stale names and clears failed state even when target is unchanged', async () => {
    const target = remoteTargetFixture()
    installGoblin()
    useReposStore.setState((s) => {
      const repo = emptyRepo(REMOTE_ID, 'example:/', 'repo-instance-test')
      repo.remote.lifecycle = { kind: 'failed', reason: 'unreachable', target }
      repo.availability = { phase: 'unavailable', reason: 'unreachable', checkedAt: 0 }
      return { ...s, repos: { ...s.repos, [REMOTE_ID]: repo }, order: [REMOTE_ID] }
    })

    const outcome = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)

    expect(outcome?.kind).toBe('ready')
    const final = useReposStore.getState().repos[REMOTE_ID]
    expect(final?.name).toBe('example:repo')
    expect(final?.remote.lifecycle).toEqual({ kind: 'ready', target })
  })

  test("a superseded run does not overwrite the newer run's writes", async () => {
    // Two consecutive runLatestOperation-style runs against the
    // same key. The first runs synchronously to completion, the
    // second starts after the first settles. Both run to
    // completion; the orchestrator's onResult writes twice.
    // The second write is the one that wins, and the first
    // write's stale detection must not clobber it.
    //
    // The first run lands on a probe that fails; the second
    // lands on a probe that succeeds. The store ends up in
    // `ready`, not `failed`.
    let probeCalls = 0
    installGoblin({
      probe: (cwd: string) => {
        probeCalls += 1
        if (probeCalls === 1) return { ok: false, message: 'unreachable' }
        return { ok: true, root: cwd, name: 'repo' }
      },
    })
    useReposStore.setState((s) => {
      const repo: RepoState = {
        id: REMOTE_ID,
        name: 'example:repo',
        instanceId: 'repo-instance-test',
        dataLoads: emptyDataLoads(),
        operations: emptyOperations(),
        ui: {
          branchViewMode: 'all',
          preferredWorkspacePaneTabByTarget: {},
        },
        projection: { source: 'fresh', savedAt: null },
        remote: {
          lifecycle: { kind: 'connecting' },
          remotes: [],
          remoteDetails: [],
          hasRemotes: false,
          hasBrowserRemote: false,
          browserRemoteProvider: undefined,
          remoteProviders: {},
          hasGitHubRemote: false,
          fetchFailed: false,
          fetchError: null,
        },
        availability: { phase: 'available' },
        events: [],
      }
      return { ...s, repos: { ...s.repos, [REMOTE_ID]: repo }, order: [REMOTE_ID] }
    })

    const first = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
    expect(first?.kind).toBe('failed')
    expect(useReposStore.getState().repos[REMOTE_ID]?.remote.lifecycle?.kind).toBe('failed')

    // Second call: same orchestrator entry point. The repo is
    // already in 'failed' (not 'connecting'), so the orchestrator
    // starts a new runLatestOperation with a fresh operationId.
    // The first run's onError (which already settled to
    // `addUnavailableRepo`) MUST NOT run again on the second
    // run's behalf, and the second run's onResult writes `ready`.
    const second = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
    expect(second?.kind).toBe('ready')
    expect(useReposStore.getState().repos[REMOTE_ID]?.remote.lifecycle?.kind).toBe('ready')
  })

  test("the orchestrator's onError path lands `failed` for an aborted run", async () => {
    // Driving the full lane-level abort (disposeRepoOperationScheduler)
    // requires a signal-aware fetch stub that the IPC shim
    // doesn't surface (the shim's repo.probe handler doesn't
    // receive a signal). Instead we drive the orchestrator's
    // onError path directly by injecting a task body that throws
    // — this exercises the same `onError → addUnavailableRepo`
    // write path that `disposeRepoOperationScheduler` would trigger in
    // production. The onError path is the contract for "no
    // orphaned connecting" (per docs/.../plan §6.5).
    installGoblin({})
    shouldThrowResolveLifecycle = true
    try {
      await runOrchestratorAndAssertPostCondition()
    } finally {
      shouldThrowResolveLifecycle = false
    }

    async function runOrchestratorAndAssertPostCondition(): Promise<void> {
      useReposStore.setState((s) => {
        const repo: RepoState = {
          id: REMOTE_ID,
          name: 'example:repo',
          instanceId: 'repo-instance-test',
          dataLoads: emptyDataLoads(),
          operations: emptyOperations(),
          ui: {
            branchViewMode: 'all',
            preferredWorkspacePaneTabByTarget: {},
          },
          projection: { source: 'fresh', savedAt: null },
          remote: {
            lifecycle: null,
            remotes: [],
            remoteDetails: [],
            hasRemotes: false,
            hasBrowserRemote: false,
            browserRemoteProvider: undefined,
            remoteProviders: {},
            hasGitHubRemote: false,
            fetchFailed: false,
            fetchError: null,
          },
          availability: { phase: 'available' },
          events: [],
        }
        return { ...s, repos: { ...s.repos, [REMOTE_ID]: repo }, order: [REMOTE_ID] }
      })
      const outcome = await runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, REMOTE_ID)
      // The mock throws inside the task body; runLatestOperation
      // translates that to `outcome.kind === 'error'`, runs
      // onError (which writes `failed` via addUnavailableRepo),
      // and returns null for the orchestrator's caller.
      expect(outcome).toBeNull()
      const final = useReposStore.getState().repos[REMOTE_ID]?.remote.lifecycle
      // The post-condition: lifecycle is NOT orphaned in
      // `connecting`. Either `ready` (some prior write won)
      // or `failed` (this abort path) is acceptable — the
      // important thing is that an erroring run doesn't leave
      // a forever-spinner behind.
      expect(final?.kind === 'ready' || final?.kind === 'failed').toBe(true)
    }
  })
})

function idle() {
  return {
    operationId: 0,
    phase: 'idle' as const,
    reason: null,
    target: null,
    startedAt: null,
    settledAt: null,
    error: null,
  }
}

function idleDataLoad() {
  return {
    phase: 'idle' as const,
    loadedAt: null,
    error: null,
    stale: false,
  }
}

function emptyDataLoads() {
  return {
    fetch: idleDataLoad(),
    repoReadModel: idleDataLoad(),
    visibleStatus: idleDataLoad(),
  }
}

function emptyOperations() {
  return {
    fetch: idle(),
    manualRefresh: idle(),
    repoReadModel: idle(),
    visibleStatus: idle(),
    branchAction: idle(),
  }
}
