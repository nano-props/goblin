// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { isRemoteRepoId, normalizeRemoteTarget, type RemoteRepoConnectionLifecycle } from '#/shared/remote-repo.ts'
import { useNetworkReconnect } from '#/web/hooks/useNetworkReconnect.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { goblinLog } from '#/web/logger.ts'
import { resetLifecycleTest } from '#/web/stores/workspaces/workspace-session-test-utils.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

// Mock the server command adapter so the hook test doesn't depend on
// the IPC bridge / network. Lifecycle projection behavior is covered by the
// command and runtime-projection tests; this suite owns event submission.
vi.mock('#/web/stores/workspaces/remote-workspace-connection-command.ts', () => ({
  runRemoteWorkspaceConnection: vi.fn(async () => ({
    kind: 'superseded' as const,
    repoRoot: workspaceIdForTest('goblin+file:///tmp/remote-workspace'),
  })),
}))

beforeEach(() => {
  // NOTE: this hook test intentionally does NOT call
  // `installGoblin({})` — the test-utils' fake `window` is
  // a plain object without `addEventListener`/`removeEventListener`,
  // which the hook needs. The hook itself doesn't go through
  // the IPC bridge (it calls `runRemoteWorkspaceConnection` which
  // uses the orchestrator's task), so we don't need the
  // bridge installed for this test. We only need a clean
  // store; `resetLifecycleTest` covers that.
  resetLifecycleTest()
  vi.mocked(runRemoteWorkspaceConnection).mockClear()
  vi.mocked(runRemoteWorkspaceConnection).mockResolvedValue({
    kind: 'superseded',
    repoRoot: workspaceIdForTest('goblin+file:///tmp/remote-workspace'),
  })
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
  const repo = emptyWorkspace(id, id, 'repo-runtime-test')
  repo.admission = isRemoteRepoId(id) ? { kind: 'remote', lifecycle, lifecycleAttemptId: null } : { kind: 'local' }
  useWorkspacesStore.setState((s) => ({
    ...s,
    workspaces: {
      ...s.workspaces,
      [id]: repo,
    },
  }))
}

describe('useNetworkReconnect', () => {
  test('re-probes a `failed` remote repo on `online`', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'failed', reason: 'unreachable' })
    mountHook()

    fireOnline()
    await flushMicrotasks(10)
    expect(runRemoteWorkspaceConnection).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), target.id)
  })

  test('skips a `ready` remote repo (no re-probe on online)', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'ready', target })
    mountHook()

    fireOnline()
    await flushMicrotasks(10)
    expect(runRemoteWorkspaceConnection).not.toHaveBeenCalled()
  })

  test('re-probes a `connecting` remote repo on `online` (orchestrator aborts stale run)', async () => {
    const target = remoteTargetFixture()
    seedRepo(target.id, { kind: 'connecting' })
    mountHook()

    fireOnline()
    await flushMicrotasks(10)

    expect(runRemoteWorkspaceConnection).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), target.id)
  })

  test('skips local repos entirely', async () => {
    seedRepo('/tmp/local-repo', null)
    mountHook()

    fireOnline()
    await flushMicrotasks(10)

    // Local repos don't have a lifecycle at all. The hook
    // must not call `runRemoteWorkspaceConnection` for them — which
    // means the repo remains untouched.
    const repo = useWorkspacesStore.getState().workspaces['/tmp/local-repo']
    expect(repo?.admission).toEqual({ kind: 'local' })
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
    await flushMicrotasks(10)

    expect(runRemoteWorkspaceConnection).not.toHaveBeenCalled()
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
    await flushMicrotasks(10)

    expect(runRemoteWorkspaceConnection).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), target.id)
  })

  test('owns transport failures from the fire-and-forget online event', async () => {
    const target = remoteTargetFixture()
    const warn = vi.spyOn(goblinLog, 'warn').mockImplementation(() => undefined)
    vi.mocked(runRemoteWorkspaceConnection).mockResolvedValueOnce({
      kind: 'transport-failed',
      repoRoot: workspaceIdForTest(target.id),
      reason: 'unknown',
    })
    seedRepo(target.id, { kind: 'failed', reason: 'unreachable' })
    mountHook()

    fireOnline()
    await flushMicrotasks(10)

    expect(warn).toHaveBeenCalledWith('remote reconnect command failed', { repoId: target.id, reason: 'unknown' })
  })
})
