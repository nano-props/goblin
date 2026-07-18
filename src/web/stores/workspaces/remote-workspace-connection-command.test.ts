import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceRemoteAdmission } from '#/web/workspace-capability.ts'
import { resolveRemoteRepoConnection } from '#/web/remote-client.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
import { refreshWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

vi.mock('#/web/remote-client.ts', () => ({ resolveRemoteRepoConnection: vi.fn() }))
vi.mock('#/web/stores/workspaces/refresh.ts', () => ({ requestRepoProjectionReadModelRefresh: vi.fn(async () => {}) }))
vi.mock('#/web/workspace-runtime-query.ts', () => ({ refreshWorkspaceRuntimes: vi.fn() }))

const repoId = workspaceIdForTest('goblin+ssh://example/repo')
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
    const repo = emptyWorkspace(repoId, 'repo', runtimeId)
    if (repo.admission.kind !== 'remote') throw new Error('expected remote workspace admission')
    repo.admission.lifecycle = { kind: 'failed', reason: 'unreachable' }
    useWorkspacesStore.setState({ workspaces: { [repoId]: repo }, workspaceOrder: [repoId] })
    vi.mocked(refreshWorkspaceRuntimes).mockResolvedValue({
      runtimes: [
        {
          workspaceId: repoId,
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
    let release!: (value: Awaited<ReturnType<typeof resolveRemoteRepoConnection>>) => void
    vi.mocked(resolveRemoteRepoConnection).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const pending = runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, repoId)
    expect(resolveRemoteRepoConnection).toHaveBeenCalledWith({ repoId, workspaceRuntimeId: runtimeId }, undefined)
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
    release({ kind: 'settled', repoId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 1, target } })
    await expect(pending).resolves.toMatchObject({ kind: 'ready', repoRoot: repoId })
  })

  test('applies the canonical terminal through the runtime projection acceptor', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockResolvedValue({
      kind: 'settled',
      repoId,
      name: 'repo',
      lifecycle: { kind: 'ready', attemptId: 3, target },
    })
    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, repoId),
    ).resolves.toMatchObject({
      kind: 'ready',
      target,
    })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoId])).toMatchObject({
      lifecycle: { kind: 'ready', target },
      lifecycleAttemptId: 3,
    })
    expect(requestRepoProjectionReadModelRefresh).toHaveBeenCalledWith(expect.anything(), repoId, {
      workspaceRuntimeId: runtimeId,
    })
  })

  test('rejects a wire response for a different workspace before applying projection state', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockResolvedValue({
      kind: 'superseded',
      repoId: 'goblin+ssh://example/other-workspace',
    })

    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, repoId),
    ).resolves.toEqual({ kind: 'stale-runtime', repoRoot: repoId })
    expect(refreshWorkspaceRuntimes).not.toHaveBeenCalled()
  })

  test('does not apply a response to a replaced runtime generation', async () => {
    let release!: (value: Awaited<ReturnType<typeof resolveRemoteRepoConnection>>) => void
    vi.mocked(resolveRemoteRepoConnection).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const pending = runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, repoId)
    useWorkspacesStore.setState((state) => ({
      workspaces: { ...state.workspaces, [repoId]: { ...state.workspaces[repoId]!, workspaceRuntimeId: 'repo-runtime-test-2' } },
    }))
    release({ kind: 'settled', repoId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 1, target } })
    await expect(pending).resolves.toEqual({ kind: 'stale-runtime', repoRoot: repoId })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('does not write lifecycle state for a superseded command', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockResolvedValue({ kind: 'superseded', repoId })
    await expect(
      runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, repoId),
    ).resolves.toMatchObject({
      kind: 'superseded',
    })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('normalizes command abort without synthesizing local lifecycle state', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, repoId)).resolves.toEqual({
      kind: 'cancelled',
      repoRoot: repoId,
    })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })

  test('normalizes transport failure without synthesizing local lifecycle state', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockRejectedValue(new Error('offline'))
    await expect(runRemoteWorkspaceConnection(useWorkspacesStore.setState, useWorkspacesStore.getState, repoId)).resolves.toEqual({
      kind: 'transport-failed',
      repoRoot: repoId,
      reason: 'unknown',
    })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoId])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })
  })
})
