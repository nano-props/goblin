import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceRemoteAdmission } from '#/web/workspace-capability.ts'
import { resolveRemoteWorkspaceConnection } from '#/web/remote-workspace-client.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
import { invalidateWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

vi.mock('#/web/remote-workspace-client.ts', () => ({ resolveRemoteWorkspaceConnection: vi.fn() }))
vi.mock('#/web/stores/workspaces/refresh.ts', () => ({ requestRepoProjectionReadModelRefresh: vi.fn(async () => {}) }))
vi.mock('#/web/workspace-runtime-query.ts', () => ({ invalidateWorkspaceRuntimes: vi.fn() }))

const workspaceId = workspaceIdForTest('goblin+ssh://example/repo')
const runtimeId = 'repo-runtime-test-1'
const target = normalizeRemoteTarget({
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/repo',
})!

describe('remote lifecycle command client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const repo = emptyWorkspace(workspaceId, 'repo', runtimeId)
    if (repo.admission.kind !== 'remote') throw new Error('expected remote workspace admission')
    repo.admission.lifecycle = { kind: 'failed', reason: 'unreachable' }
    useWorkspacesStore.setState({ workspaces: { [workspaceId]: repo }, workspaceOrder: [workspaceId] })
    vi.mocked(invalidateWorkspaceRuntimes).mockResolvedValue({
      runtimes: [
        {
          workspaceId: workspaceId,
          workspaceRuntimeId: runtimeId,
          remoteLifecycle: { kind: 'ready', attemptId: 3, target },
          workspaceProbe: {
            status: 'ready',
            name: 'repo',
            capabilities: {
              files: { read: true, write: true },
              terminal: { available: true },
              git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
            },
            diagnostics: [],
          },
        },
      ],
    })
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
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[workspaceId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
    release({ kind: 'settled', workspaceId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 3, target } })
    await expect(pending).resolves.toMatchObject({ kind: 'ready', workspaceId: workspaceId })
  })

  test('applies the canonical terminal through the runtime projection acceptor', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({
      kind: 'settled',
      workspaceId,
      name: 'repo',
      lifecycle: { kind: 'ready', attemptId: 3, target },
    })
    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toMatchObject({
      kind: 'ready',
      target,
    })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[workspaceId])).toMatchObject({
      lifecycle: { kind: 'ready', target },
      lifecycleAttemptId: 3,
    })
    expect(requestRepoProjectionReadModelRefresh).toHaveBeenCalledWith(expect.anything(), workspaceId, {
      workspaceRuntimeId: runtimeId,
    })
  })

  test('rejects a wire response for a different workspace before applying projection state', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({
      kind: 'superseded',
      workspaceId: workspaceIdForTest('goblin+ssh://example/other-workspace'),
    })

    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toEqual({ kind: 'stale-runtime', workspaceId: workspaceId })
    expect(invalidateWorkspaceRuntimes).not.toHaveBeenCalled()
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
    release({ kind: 'settled', workspaceId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 1, target } })
    await expect(pending).resolves.toEqual({ kind: 'stale-runtime', workspaceId: workspaceId })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[workspaceId])).toMatchObject({
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
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[workspaceId])).toMatchObject({
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
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[workspaceId])).toMatchObject({
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
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[workspaceId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('normalizes a terminal projection refresh failure', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({
      kind: 'settled',
      workspaceId,
      name: 'repo',
      lifecycle: { kind: 'ready', attemptId: 3, target },
    })
    vi.mocked(invalidateWorkspaceRuntimes).mockRejectedValue(new Error('offline'))

    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toEqual({ kind: 'transport-failed', workspaceId, reason: 'unknown' })
  })

  test('does not report or enrich a command superseded by a newer runtime attempt', async () => {
    vi.mocked(resolveRemoteWorkspaceConnection).mockResolvedValue({
      kind: 'settled',
      workspaceId,
      name: 'repo',
      lifecycle: { kind: 'ready', attemptId: 3, target },
    })
    vi.mocked(invalidateWorkspaceRuntimes).mockResolvedValue({
      runtimes: [
        {
          workspaceId,
          workspaceRuntimeId: runtimeId,
          remoteLifecycle: { kind: 'failed', attemptId: 4, reason: 'unreachable', target },
          workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
        },
      ],
    })

    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, workspaceId),
    ).resolves.toEqual({ kind: 'superseded', workspaceId })
    expect(requestRepoProjectionReadModelRefresh).not.toHaveBeenCalled()
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[workspaceId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
      lifecycleAttemptId: 4,
    })
  })
})
