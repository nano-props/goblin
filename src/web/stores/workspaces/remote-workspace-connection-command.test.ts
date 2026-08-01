import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { resolveRemoteWorkspaceConnection } from '#/web/remote-workspace-client.ts'
import { requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

vi.mock('#/web/remote-workspace-client.ts', () => ({ resolveRemoteWorkspaceConnection: vi.fn() }))
vi.mock('#/web/stores/workspaces/refresh.ts', () => ({ requestRepoSnapshotRefresh: vi.fn(async () => {}) }))

const workspaceId = workspaceIdForTest('goblin+ssh://example/repo')
const runtimeId = 'repo-runtime-test-1'
const target = normalizeRemoteTarget({
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/repo',
})!
const readyProbe = {
  status: 'ready' as const,
  capabilities: {
    files: { read: true as const, write: true },
    terminal: { available: true },
    git: {
      status: 'available' as const,
      worktrees: true,
      pullRequests: { provider: 'none' as const },
    },
  },
  diagnostics: [],
}

describe('remote lifecycle command client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const repo = emptyWorkspace(workspaceId, runtimeId)
    if (repo.admission.kind !== 'remote') throw new Error('expected remote workspace admission')
    repo.admission.lifecycle = { kind: 'failed', reason: 'unreachable' }
    useWorkspacesStore.setState({ workspaces: { [workspaceId]: repo }, workspaceOrder: [workspaceId] })
  })

  test('sends the runtime generation and does not manufacture connecting', async () => {
    let release!: (value: Awaited<ReturnType<typeof resolveRemoteWorkspaceConnection>>) => void
    vi.mocked(resolveRemoteWorkspaceConnection).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const pending = runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId)
    expect(resolveRemoteWorkspaceConnection).toHaveBeenCalledWith(
      { workspaceId, workspaceRuntimeId: runtimeId },
      undefined,
    )
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
    release({
      kind: 'settled',
      workspaceId,
      lifecycle: { kind: 'ready', attemptId: 3, target },
      workspaceProbe: readyProbe,
    })
    await expect(pending).resolves.toMatchObject({ kind: 'ready', workspaceId: workspaceId })
  })

  test('applies the canonical terminal through the runtime projection acceptor', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({
      kind: 'settled',
      workspaceId,
      lifecycle: { kind: 'ready', attemptId: 3, target },
      workspaceProbe: readyProbe,
    })
    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toMatchObject({
      kind: 'ready',
      target,
    })
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'ready', target },
      lifecycleAttemptId: 3,
    })
    expect(requestRepoSnapshotRefresh).toHaveBeenCalledWith(expect.anything(), workspaceId, {
      workspaceRuntimeId: runtimeId,
    })
  })

  test('applies a canonical failed terminal and probe without starting Git projection work', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({
      kind: 'settled',
      workspaceId,
      lifecycle: { kind: 'failed', attemptId: 3, reason: 'auth-failed', target },
      workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
    })

    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toEqual({
      kind: 'failed',
      workspaceId,
      reason: 'auth-failed',
      target,
    })
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'auth-failed', target },
      lifecycleAttemptId: 3,
    })
    expect(useWorkspacesStore.getState().workspaces[workspaceId]?.capability).toEqual({
      kind: 'unavailable',
      probe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
    })
    expect(requestRepoSnapshotRefresh).not.toHaveBeenCalled()
  })

  test('rejects a wire response for a different workspace before applying projection state', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({
      kind: 'superseded',
      workspaceId: workspaceIdForTest('goblin+ssh://example/other-workspace'),
    })

    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toEqual({ kind: 'stale-runtime', workspaceId: workspaceId })
  })

  test('does not apply a response to a replaced runtime generation', async () => {
    let release!: (value: Awaited<ReturnType<typeof resolveRemoteWorkspaceConnection>>) => void
    vi.mocked(resolveRemoteWorkspaceConnection).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const pending = runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId)
    useWorkspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [workspaceId]: { ...state.workspaces[workspaceId]!, workspaceRuntimeId: 'repo-runtime-test-2' },
      },
    }))
    release({
      kind: 'settled',
      workspaceId,
      lifecycle: { kind: 'ready', attemptId: 1, target },
      workspaceProbe: readyProbe,
    })
    await expect(pending).resolves.toEqual({ kind: 'stale-runtime', workspaceId: workspaceId })
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('does not write lifecycle state for a superseded command', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({ kind: 'superseded', workspaceId })
    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toMatchObject({
      kind: 'superseded',
    })
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('normalizes command abort without synthesizing local lifecycle state', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toEqual({
      kind: 'cancelled',
      workspaceId: workspaceId,
    })
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('normalizes transport failure without synthesizing local lifecycle state', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockRejectedValue(new Error('offline'))
    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toEqual({
      kind: 'transport-failed',
      workspaceId: workspaceId,
      reason: 'unknown',
    })
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('does not report or enrich a command superseded by a newer runtime attempt', async () => {
    const response = Promise.withResolvers<Awaited<ReturnType<typeof resolveRemoteWorkspaceConnection>>>()
    vi.mocked(resolveRemoteWorkspaceConnection).mockReturnValue(response.promise)
    const pending = runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId)
    const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
    if (workspace?.admission.kind !== 'remote') throw new Error('expected remote workspace admission')
    workspace.admission.lifecycle = { kind: 'failed', reason: 'unreachable', target }
    workspace.admission.lifecycleAttemptId = 4
    response.resolve({
      kind: 'settled',
      workspaceId,
      lifecycle: { kind: 'ready', attemptId: 3, target },
      workspaceProbe: readyProbe,
    })

    await expect(pending).resolves.toEqual({ kind: 'superseded', workspaceId })
    expect(requestRepoSnapshotRefresh).not.toHaveBeenCalled()
    expect(remoteAdmission()).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
      lifecycleAttemptId: 4,
    })
  })
})

function remoteAdmission() {
  const admission = useWorkspacesStore.getState().workspaces[workspaceId]?.admission
  if (admission?.kind !== 'remote') throw new Error('expected remote workspace admission')
  return admission
}
