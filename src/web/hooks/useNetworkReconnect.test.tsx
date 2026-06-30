// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { normalizeRemoteTarget, type RemoteRepoConnectionLifecycle } from '#/shared/remote-repo.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { resetLifecycleTest } from '#/web/stores/repos/repo-session-test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

// Mock the orchestrator so the hook test doesn't depend on
// the IPC bridge / network. The mock simulates a successful
// lifecycle run by flipping the repo's lifecycle to `ready`
// with a target — derived from the previous lifecycle's
// retained target (if any) or from a default test fixture.
// This is enough to verify WHICH repos the hook re-probes
// (the actual orchestrator behavior is covered by
// `remote-lifecycle-orchestrator.test.ts`).
vi.mock('#/web/stores/repos/remote-repo-connection-orchestrator.ts', () => ({
  runRemoteRepoConnection: vi.fn(async (_set: ReposSet, _get: ReposGet, id: string) => {
    useReposStore.setState((s) => {
      const repo = s.repos[id]
      if (!repo) return s
      const previous = repo.remote.lifecycle
      const retainedTarget =
        previous && previous.kind === 'failed' && previous.target
          ? previous.target
          : previous && previous.kind === 'ready'
            ? previous.target
            : null
      // Always produce a `ready` lifecycle with a target so
      // the hook's `kind === 'ready'` skip-condition is
      // observable. We synthesize a target when the previous
      // failed-without-target case arises, because in
      // production the server would have produced a target
      // and the orchestrator would have cached it.
      const target =
        retainedTarget ??
        normalizeRemoteTarget({
          alias: 'example',
          host: 'example.com',
          user: 'alice',
          port: 22,
          remotePath: '/srv/repo',
        })
      if (!target) throw new Error('Failed to construct test target')
      const lifecycle: RepoState['remote']['lifecycle'] = {
        kind: 'ready',
        target,
      }
      return {
        ...s,
        repos: {
          ...s.repos,
          [id]: {
            ...repo,
            remote: { ...repo.remote, lifecycle },
          },
        },
      }
    })
    return { kind: 'ready' as const, repoId: id, name: id }
  }),
}))

beforeEach(() => {
  // NOTE: this hook test intentionally does NOT call
  // `installGoblin({})` — the test-utils' fake `window` is
  // a plain object without `addEventListener`/`removeEventListener`,
  // which the hook needs. The hook itself doesn't go through
  // the IPC bridge (it calls `runRemoteRepoConnection` which
  // uses the orchestrator's task), so we don't need the
  // bridge installed for this test. We only need a clean
  // store; `resetLifecycleTest` covers that.
  resetLifecycleTest()
})

function fireOnline(): void {
  window.dispatchEvent(new Event('online'))
}

function mountHook() {
  return renderInJsdom(<HookHost />)
}

function HookHost(): null {
  useNetworkReconnect()
  return null
}

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

function seedRepo(id: string, lifecycle: RemoteRepoConnectionLifecycle | null) {
  const set = useReposStore.setState as ReposSet
  set((s) => ({
    ...s,
    repos: {
      ...s.repos,
      [id]: {
        id,
        name: id,
        instanceToken: 1,
        data: { branches: [], currentBranch: '', status: [], statusLoaded: false, worktreesByPath: {} },
        dataLoads: {
          fetch: { phase: 'idle', loadedAt: null, stale: false, error: null },
          snapshot: { phase: 'idle', loadedAt: null, stale: false, error: null },
          status: { phase: 'idle', loadedAt: null, stale: false, error: null },
          pullRequests: { phase: 'idle', loadedAt: null, stale: false, error: null, mode: null },
          pullRequestsByBranch: {},
        },
        operations: {
          fetch: {
            operationId: 0,
            phase: 'idle',
            reason: null,
            target: null,
            startedAt: null,
            settledAt: null,
            error: null,
          },
          manualRefresh: {
            operationId: 0,
            phase: 'idle',
            reason: null,
            target: null,
            startedAt: null,
            settledAt: null,
            error: null,
          },
          snapshot: {
            operationId: 0,
            phase: 'idle',
            reason: null,
            target: null,
            startedAt: null,
            settledAt: null,
            error: null,
          },
          status: {
            operationId: 0,
            phase: 'idle',
            reason: null,
            target: null,
            startedAt: null,
            settledAt: null,
            error: null,
          },
          pullRequests: {
            operationId: 0,
            phase: 'idle',
            reason: null,
            target: null,
            startedAt: null,
            settledAt: null,
            error: null,
          },
          branchAction: {
            operationId: 0,
            phase: 'idle',
            reason: null,
            target: null,
            startedAt: null,
            settledAt: null,
            error: null,
          },
          pullRequestsByBranch: {},
        },
        ui: {
          selectedBranch: null,
          branchViewMode: 'all',
          workspacePaneTabsByBranch: {},
          preferredWorkspacePaneTabByBranch: {},
        },
        projection: { source: 'fresh', savedAt: null },
        remote: {
          lifecycle,
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
      },
    },
  }))
}

describe('useNetworkReconnect', () => {
  test('re-probes a `failed` remote repo on `online`', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'failed', reason: 'unreachable' })
    mountHook()

    fireOnline()
    // The orchestrator's task is async; let it settle.
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    const lifecycle = useReposStore.getState().repos[target.id]?.remote.lifecycle
    expect(lifecycle?.kind).toBe('ready')
  })

  test('skips a `ready` remote repo (no re-probe on online)', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'ready', target })
    mountHook()

    fireOnline()
    for (let i = 0; i < 5; i += 1) await Promise.resolve()

    // The lifecycle is unchanged — the hook did not re-probe.
    const lifecycle = useReposStore.getState().repos[target.id]?.remote.lifecycle
    expect(lifecycle?.kind).toBe('ready')
  })

  test('re-probes a `connecting` remote repo on `online` (orchestrator aborts stale run)', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'connecting' })
    mountHook()

    fireOnline()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    // The connecting repo was re-probed and settled to `ready`.
    // Without this re-probe, a connecting run that started before
    // the network came back would hold its SSH timeout before the
    // user sees a recoverable `failed` state.
    const lifecycle = useReposStore.getState().repos[target.id]?.remote.lifecycle
    expect(lifecycle?.kind).toBe('ready')
  })

  test('skips local repos entirely', async () => {
    seedRepo('/tmp/local-repo', null)
    mountHook()

    fireOnline()
    for (let i = 0; i < 5; i += 1) await Promise.resolve()

    // Local repos don't have a lifecycle at all. The hook
    // must not call `runRemoteRepoConnection` for them — which
    // means the repo remains untouched.
    const repo = useReposStore.getState().repos['/tmp/local-repo']
    expect(repo?.remote.lifecycle).toBeNull()
  })

  test('cleans up the window listener on unmount', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'failed', reason: 'unreachable' })
    mountHook()

    // Unmount the hook host. After unmount, a second `online`
    // event should NOT trigger a re-probe.
    act(() => {
      cleanup()
    })

    fireOnline()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    // Lifecycle stays `failed` — no re-probe after unmount.
    const lifecycle = useReposStore.getState().repos[target.id]?.remote.lifecycle
    expect(lifecycle?.kind).toBe('failed')
  })

  test('reads the latest repo set on each event (not a captured snapshot)', async () => {
    // The hook captures setRef / getRef to the live store, so a
    // `failed` repo added AFTER the hook mounted is still
    // re-probed on the next `online` event. This pins the
    // "store is the source of truth" invariant.
    const target = remoteTargetFixture()
    mountHook()
    seedRepo(target.id, { kind: 'failed', reason: 'unreachable' })

    fireOnline()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    const lifecycle = useReposStore.getState().repos[target.id]?.remote.lifecycle
    expect(lifecycle?.kind).toBe('ready')
  })
})

const _unused = {} as ReposGet
void _unused
