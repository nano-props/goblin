// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { normalizeRemoteTarget, type RemoteRepoConnectionLifecycle } from '#/shared/remote-repo.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-command.ts'
import { goblinLog } from '#/web/logger.ts'
import { resetLifecycleTest } from '#/web/stores/repos/repo-session-test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { ReposSet } from '#/web/stores/repos/types.ts'

// Mock the server command adapter so the hook test doesn't depend on
// the IPC bridge / network. Lifecycle projection behavior is covered by the
// command and runtime-projection tests; this suite owns event submission.
vi.mock('#/web/stores/repos/remote-repo-connection-command.ts', () => ({
  runRemoteRepoConnection: vi.fn(async () => ({ kind: 'superseded' as const, repoId: 'remote', name: 'remote' })),
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
  vi.mocked(runRemoteRepoConnection).mockClear()
  vi.mocked(runRemoteRepoConnection).mockResolvedValue({ kind: 'superseded', repoId: 'remote', name: 'remote' })
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
        repoRuntimeId: 'repo-runtime-test',
        dataLoads: {
          repoReadModel: { phase: 'idle', loadedAt: null, stale: false, error: null },
          visibleStatus: { phase: 'idle', loadedAt: null, stale: false, error: null },
          fetch: { phase: 'idle', loadedAt: null, stale: false, error: null },
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
          repoReadModel: {
            operationId: 0,
            phase: 'idle',
            reason: null,
            target: null,
            startedAt: null,
            settledAt: null,
            error: null,
          },
          visibleStatus: {
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
        },
        ui: {
          currentBranchName: null,
          branchViewMode: 'all',
          workspacePaneTabsByBranch: {},
          preferredWorkspacePaneTabByTarget: {},
        },
        projection: { source: 'fresh', savedAt: null },
        remote: {
          lifecycle,
          lifecycleAttemptId: null,
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
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(runRemoteRepoConnection).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), target.id)
  })

  test('skips a `ready` remote repo (no re-probe on online)', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'ready', target })
    mountHook()

    fireOnline()
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    expect(runRemoteRepoConnection).not.toHaveBeenCalled()
  })

  test('re-probes a `connecting` remote repo on `online` (orchestrator aborts stale run)', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'connecting' })
    mountHook()

    fireOnline()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    expect(runRemoteRepoConnection).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), target.id)
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

    expect(runRemoteRepoConnection).not.toHaveBeenCalled()
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

    expect(runRemoteRepoConnection).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), target.id)
  })

  test('owns transport failures from the fire-and-forget online event', async () => {
    const target = remoteTargetFixture()
    const error = new Error('offline')
    const warn = vi.spyOn(goblinLog, 'warn').mockImplementation(() => undefined)
    vi.mocked(runRemoteRepoConnection).mockRejectedValueOnce(error)
    seedRepo(target.id, { kind: 'failed', reason: 'unreachable' })
    mountHook()

    fireOnline()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    expect(warn).toHaveBeenCalledWith('remote reconnect command failed', { repoId: target.id, error })
  })
})
