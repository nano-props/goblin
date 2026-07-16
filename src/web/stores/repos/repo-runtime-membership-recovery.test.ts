// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  closeRepoRuntimeWithCache,
  openRepoRuntimeWithCache,
  reconcileOpenRepoRuntimeMemberships,
} from '#/web/stores/repos/repo-session-write-paths.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { installGoblinTestBridge, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'

const REPO_ROOT = '/tmp/runtime-membership-recovery'
const REMOTE_REPO_ROOT = 'goblin+ssh://example/srv/runtime-membership-recovery'

describe('repo runtime membership recovery', () => {
  beforeEach(() => {
    resetReposStore()
    installGoblinTestBridge({
      'repo.runtimeReconcile': async () => ({
        runtimes: [{ repoRoot: REPO_ROOT, repoRuntimeId: 'repo-runtime-123456789012345678901' }],
      }),
    })
  })

  test('atomically advances a current repo shell to the reconciled server epoch', async () => {
    const previousRepoRuntimeId = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] }).repoRuntimeId

    const result = await reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)

    expect(result).toEqual({
      kind: 'settled',
      targets: [{ repoRoot: REPO_ROOT, repoRuntimeId: 'repo-runtime-123456789012345678901' }],
      changedTargets: [
        {
          repoRoot: REPO_ROOT,
          previousRepoRuntimeId,
          repoRuntimeId: 'repo-runtime-123456789012345678901',
        },
      ],
    })
    const repo = useReposStore.getState().repos[REPO_ROOT]
    expect(repo?.repoRuntimeId).toBe('repo-runtime-123456789012345678901')
    expect(repo?.dataLoads.repoReadModel.stale).toBe(true)
    expect(repo?.operations.repoReadModel.phase).toBe('idle')
    expect(repo?.events).toEqual([])
  })

  test('redeclares the latest window membership when a repo closes during recovery', async () => {
    resetReposStore()
    const firstResponse = Promise.withResolvers<{
      runtimes: Array<{ repoRoot: string; repoRuntimeId: string }>
    }>()
    const reconcile = vi.fn().mockReturnValueOnce(firstResponse.promise).mockResolvedValueOnce({ runtimes: [] })
    installGoblinTestBridge({ 'repo.runtimeReconcile': reconcile })
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })

    const recovery = reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    useReposStore.setState({ repos: {}, order: [] })
    firstResponse.resolve({
      runtimes: [{ repoRoot: REPO_ROOT, repoRuntimeId: 'repo-runtime-123456789012345678901' }],
    })

    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [], changedTargets: [] })
    expect(reconcile).toHaveBeenNthCalledWith(1, expect.objectContaining({ repoRoots: [REPO_ROOT] }))
    expect(reconcile).toHaveBeenNthCalledWith(2, expect.objectContaining({ repoRoots: [] }))
  })

  test('serializes full-set recovery with explicit open membership commands', async () => {
    resetReposStore()
    const reconcileResponse = Promise.withResolvers<{ runtimes: [] }>()
    const runtimeOpen = vi.fn(async () => ({ ok: true, repoRuntimeId: 'repo-runtime-123456789012345678901' }))
    installGoblinTestBridge({
      'repo.runtimeReconcile': () => reconcileResponse.promise,
      'repo.runtimeOpen': runtimeOpen,
    })

    const recovery = reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)
    const open = openRepoRuntimeWithCache(REPO_ROOT)
    await Promise.resolve()
    expect(runtimeOpen).not.toHaveBeenCalled()

    reconcileResponse.resolve({ runtimes: [] })
    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [], changedTargets: [] })
    await expect(open).resolves.toBe('repo-runtime-123456789012345678901')
    expect(runtimeOpen).toHaveBeenCalledOnce()
  })

  test('serializes full-set recovery with explicit close membership commands', async () => {
    resetReposStore()
    const repo = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    const reconcileResponse = Promise.withResolvers<{
      runtimes: Array<{ repoRoot: string; repoRuntimeId: string }>
    }>()
    const runtimeClose = vi.fn(async () => ({ ok: true, released: true, runtimeClosed: true }))
    installGoblinTestBridge({
      'repo.runtimeReconcile': () => reconcileResponse.promise,
      'repo.runtimeClose': runtimeClose,
    })

    const recovery = reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)
    const close = closeRepoRuntimeWithCache(REPO_ROOT, repo.repoRuntimeId)
    await Promise.resolve()
    expect(runtimeClose).not.toHaveBeenCalled()

    reconcileResponse.resolve({ runtimes: [{ repoRoot: REPO_ROOT, repoRuntimeId: repo.repoRuntimeId }] })
    await expect(recovery).resolves.toMatchObject({ kind: 'settled' })
    await close
    expect(runtimeClose).toHaveBeenCalledOnce()
  })

  test('observes the local repo commit that follows a queued runtime open', async () => {
    resetReposStore()
    const reconcile = vi.fn(async () => ({
      runtimes: [
        {
          repoRoot: REPO_ROOT,
          repoRuntimeId: 'repo-runtime-123456789012345678901',
          workspaceProbe: { status: 'probing' as const },
        },
      ],
    }))
    installGoblinTestBridge({
      'repo.runtimeOpen': async () => ({ ok: true, repoRuntimeId: 'repo-runtime-123456789012345678901' }),
      'repo.runtimeReconcile': reconcile,
    })
    const opening = (async () => {
      const repoRuntimeId = await openRepoRuntimeWithCache(REPO_ROOT)
      seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [], repoRuntimeId })
    })()
    const recovery = reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)

    await opening
    await recovery

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ repoRoots: [REPO_ROOT] }))
  })

  test('keeps production local open acquire and shell commit inside one shared lease', async () => {
    resetReposStore()
    const reconcile = vi.fn(async () => ({
      runtimes: [{ repoRoot: REPO_ROOT, repoRuntimeId: 'repo-runtime-123456789012345678901' }],
    }))
    installGoblinTestBridge({
      'repo.runtimeOpen': async () => ({
        ok: true,
        repo: { id: REPO_ROOT, name: 'runtime-membership-recovery' },
        repoRuntimeId: 'repo-runtime-123456789012345678901',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      }),
      'repo.runtimeReconcile': reconcile,
      'settings.addWorkspaceRepo': async () => ({
        openRepoEntries: [{ kind: 'local', id: REPO_ROOT }],
        workspacePaneTabsByTargetByRepo: {},
      }),
    })

    const opening = useReposStore.getState().ensureWorkspaceOpen(REPO_ROOT)
    const recovery = reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)

    await expect(opening).resolves.toMatchObject({ ok: true, id: REPO_ROOT })
    await expect(recovery).resolves.toMatchObject({ kind: 'settled' })
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ repoRoots: [REPO_ROOT] }))
  })

  test('does not block membership or scope recovery on remote lifecycle ensure', async () => {
    resetReposStore()
    const remoteEnsure = Promise.withResolvers<{ kind: 'superseded'; repoId: string }>()
    const nextRemoteRuntimeId = 'repo-runtime-123456789012345678901'
    seedRepoWithReadModelForTest({ id: REMOTE_REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'repo.runtimeReconcile': async () => ({
        runtimes: [
          {
            repoRoot: REMOTE_REPO_ROOT,
            repoRuntimeId: nextRemoteRuntimeId,
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': () => remoteEnsure.promise,
      'repo.runtimeOpen': async () => ({ ok: true, repoRuntimeId: 'repo-runtime-abcdefghijklmnopqrstu' }),
    })

    const recovery = reconcileOpenRepoRuntimeMemberships(useReposStore.setState, useReposStore.getState)
    await vi.waitFor(() => {
      expect(useReposStore.getState().repos[REMOTE_REPO_ROOT]?.repoRuntimeId).toBe(nextRemoteRuntimeId)
    })

    await expect(openRepoRuntimeWithCache('/tmp/unrelated-runtime')).resolves.toBe('repo-runtime-abcdefghijklmnopqrstu')
    await expect(recovery).resolves.toMatchObject({ kind: 'settled' })

    remoteEnsure.resolve({ kind: 'superseded', repoId: REMOTE_REPO_ROOT })
  })
})
