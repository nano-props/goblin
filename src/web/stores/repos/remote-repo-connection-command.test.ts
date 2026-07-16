import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-command.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resolveRemoteRepoConnection } from '#/web/remote-client.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/repos/refresh.ts'

vi.mock('#/web/remote-client.ts', () => ({ resolveRemoteRepoConnection: vi.fn() }))
vi.mock('#/web/stores/repos/refresh.ts', () => ({ requestRepoProjectionReadModelRefresh: vi.fn(async () => {}) }))

const repoId = 'goblin+ssh://example/repo'
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
    const repo = emptyRepo(repoId, 'repo', runtimeId)
    repo.remote.lifecycle = { kind: 'failed', reason: 'unreachable' }
    useReposStore.setState({ repos: { [repoId]: repo }, order: [repoId] })
  })

  test('sends the runtime generation and does not manufacture connecting', async () => {
    let release!: (value: Awaited<ReturnType<typeof resolveRemoteRepoConnection>>) => void
    vi.mocked(resolveRemoteRepoConnection).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const pending = runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, repoId)
    expect(resolveRemoteRepoConnection).toHaveBeenCalledWith({ repoId, repoRuntimeId: runtimeId }, undefined)
    expect(useReposStore.getState().repos[repoId]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'unreachable',
    })
    release({ kind: 'settled', repoId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 1, target } })
    await expect(pending).resolves.toMatchObject({ kind: 'ready', repoId })
  })

  test('applies the canonical terminal through the runtime projection acceptor', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockResolvedValue({
      kind: 'settled',
      repoId,
      name: 'repo',
      lifecycle: { kind: 'ready', attemptId: 3, target },
    })
    await expect(
      runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, repoId),
    ).resolves.toMatchObject({
      kind: 'ready',
      target,
    })
    expect(useReposStore.getState().repos[repoId]?.remote.lifecycle).toEqual({ kind: 'ready', target })
    expect(useReposStore.getState().repos[repoId]?.remote.lifecycleAttemptId).toBe(3)
    expect(requestRepoProjectionReadModelRefresh).toHaveBeenCalledWith(expect.anything(), repoId, {
      repoRuntimeId: runtimeId,
    })
  })

  test('does not apply a response to a replaced runtime generation', async () => {
    let release!: (value: Awaited<ReturnType<typeof resolveRemoteRepoConnection>>) => void
    vi.mocked(resolveRemoteRepoConnection).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const pending = runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, repoId)
    useReposStore.setState((state) => ({
      repos: { ...state.repos, [repoId]: { ...state.repos[repoId]!, repoRuntimeId: 'repo-runtime-test-2' } },
    }))
    release({ kind: 'settled', repoId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 1, target } })
    await expect(pending).resolves.toEqual({ kind: 'stale-runtime', repoId })
    expect(useReposStore.getState().repos[repoId]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'unreachable',
    })
  })

  test('does not write lifecycle state for a superseded command', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockResolvedValue({ kind: 'superseded', repoId })
    await expect(
      runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, repoId),
    ).resolves.toMatchObject({
      kind: 'superseded',
    })
    expect(useReposStore.getState().repos[repoId]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'unreachable',
    })
  })

  test('normalizes command abort without synthesizing local lifecycle state', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, repoId)).resolves.toEqual({
      kind: 'cancelled',
      repoId,
    })
    expect(useReposStore.getState().repos[repoId]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'unreachable',
    })
  })

  test('normalizes transport failure without synthesizing local lifecycle state', async () => {
    vi.mocked(resolveRemoteRepoConnection).mockRejectedValue(new Error('offline'))
    await expect(runRemoteRepoConnection(useReposStore.setState, useReposStore.getState, repoId)).resolves.toEqual({
      kind: 'transport-failed',
      repoId,
      reason: 'unknown',
    })
    expect(useReposStore.getState().repos[repoId]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'unreachable',
    })
  })
})
