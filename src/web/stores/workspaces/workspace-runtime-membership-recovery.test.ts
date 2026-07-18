// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  closeWorkspaceRuntimeWithCache,
  openWorkspaceRuntimeWithCache,
  reconcileOpenWorkspaceRuntimeMemberships,
} from '#/web/stores/workspaces/workspace-session-write-paths.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { installGoblinTestBridge, resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const REPO_ROOT = workspaceIdForTest('goblin+file:///tmp/runtime-membership-recovery')
const REMOTE_REPO_ROOT = workspaceIdForTest('goblin+ssh://example/srv/runtime-membership-recovery')

describe('workspace runtime membership recovery', () => {
  beforeEach(() => {
    resetWorkspacesStore()
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [{ workspaceId: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }],
      }),
    })
  })

  test('atomically advances a current repo shell to the reconciled server epoch', async () => {
    const previousWorkspaceRuntimeId = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] }).workspaceRuntimeId

    const result = await reconcileOpenWorkspaceRuntimeMemberships(
      useWorkspacesStore.setState,
      useWorkspacesStore.getState,
    )

    expect(result).toEqual({
      kind: 'settled',
      targets: [{ workspaceId: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }],
      changedTargets: [
        {
          workspaceId: REPO_ROOT,
          previousWorkspaceRuntimeId,
          workspaceRuntimeId: 'repo-runtime-123456789012345678901',
        },
      ],
    })
    const repo = useWorkspacesStore.getState().workspaces[REPO_ROOT]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-123456789012345678901')
    expect(repo?.capability).toEqual({ kind: 'probing', probe: { status: 'probing' } })
  })

  test('redeclares the latest window membership when a repo closes during recovery', async () => {
    resetWorkspacesStore()
    const firstResponse = Promise.withResolvers<{
      runtimes: Array<{ workspaceId: string; workspaceRuntimeId: string }>
    }>()
    const reconcile = vi.fn().mockReturnValueOnce(firstResponse.promise).mockResolvedValueOnce({ runtimes: [] })
    installGoblinTestBridge({ 'workspace.runtimeReconcile': reconcile })
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState)
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    useWorkspacesStore.setState({ workspaces: {}, workspaceOrder: [] })
    firstResponse.resolve({
      runtimes: [{ workspaceId: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }],
    })

    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [], changedTargets: [] })
    expect(reconcile).toHaveBeenNthCalledWith(1, expect.objectContaining({ workspaceIds: [REPO_ROOT] }))
    expect(reconcile).toHaveBeenNthCalledWith(2, expect.objectContaining({ workspaceIds: [] }))
  })

  test('serializes full-set recovery with explicit open membership commands', async () => {
    resetWorkspacesStore()
    const reconcileResponse = Promise.withResolvers<{ runtimes: [] }>()
    const runtimeOpen = vi.fn(async () => ({ ok: true, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }))
    installGoblinTestBridge({
      'workspace.runtimeReconcile': () => reconcileResponse.promise,
      'workspace.runtimeOpen': runtimeOpen,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState)
    const open = openWorkspaceRuntimeWithCache(REPO_ROOT)
    await Promise.resolve()
    expect(runtimeOpen).not.toHaveBeenCalled()

    reconcileResponse.resolve({ runtimes: [] })
    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [], changedTargets: [] })
    await expect(open).resolves.toBe('repo-runtime-123456789012345678901')
    expect(runtimeOpen).toHaveBeenCalledOnce()
  })

  test('serializes full-set recovery with explicit close membership commands', async () => {
    resetWorkspacesStore()
    const repo = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    const reconcileResponse = Promise.withResolvers<{
      runtimes: Array<{ workspaceId: string; workspaceRuntimeId: string }>
    }>()
    const runtimeClose = vi.fn(async () => ({ ok: true, released: true, runtimeClosed: true }))
    installGoblinTestBridge({
      'workspace.runtimeReconcile': () => reconcileResponse.promise,
      'workspace.runtimeClose': runtimeClose,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState)
    const close = closeWorkspaceRuntimeWithCache(REPO_ROOT, repo.workspaceRuntimeId)
    await Promise.resolve()
    expect(runtimeClose).not.toHaveBeenCalled()

    reconcileResponse.resolve({ runtimes: [{ workspaceId: REPO_ROOT, workspaceRuntimeId: repo.workspaceRuntimeId }] })
    await expect(recovery).resolves.toMatchObject({ kind: 'settled' })
    await close
    expect(runtimeClose).toHaveBeenCalledOnce()
  })

  test('observes the local repo commit that follows a queued runtime open', async () => {
    resetWorkspacesStore()
    const reconcile = vi.fn(async () => ({
      runtimes: [
        {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: 'repo-runtime-123456789012345678901',
          workspaceProbe: { status: 'probing' as const },
        },
      ],
    }))
    installGoblinTestBridge({
      'workspace.runtimeOpen': async () => ({ ok: true, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }),
      'workspace.runtimeReconcile': reconcile,
    })
    const opening = (async () => {
      const workspaceRuntimeId = await openWorkspaceRuntimeWithCache(REPO_ROOT)
      seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [], workspaceRuntimeId })
    })()
    const recovery = reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState)

    await opening
    await recovery

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ workspaceIds: [REPO_ROOT] }))
  })

  test('keeps production local open acquire and shell commit inside one shared lease', async () => {
    resetWorkspacesStore()
    const reconcile = vi.fn(async () => ({
      runtimes: [{ workspaceId: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }],
    }))
    installGoblinTestBridge({
      'workspace.runtimeOpen': async () => ({
        ok: true,
        workspace: { id: REPO_ROOT, name: 'runtime-membership-recovery' },
        workspaceRuntimeId: 'repo-runtime-123456789012345678901',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      }),
      'workspace.runtimeReconcile': reconcile,
      'settings.addWorkspaceRepo': async () => ({
        openWorkspaceEntries: [{ kind: 'local', id: REPO_ROOT }],
        workspacePaneTabsByTargetByWorkspace: {},
      }),
    })

    const opening = useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_ROOT)
    const recovery = reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState)

    await expect(opening).resolves.toMatchObject({ ok: true, workspaceId: REPO_ROOT })
    await expect(recovery).resolves.toMatchObject({ kind: 'settled' })
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ workspaceIds: [REPO_ROOT] }))
  })

  test('does not block membership or scope recovery on remote lifecycle ensure', async () => {
    resetWorkspacesStore()
    const remoteEnsure = Promise.withResolvers<{ kind: 'superseded'; workspaceId: WorkspaceId }>()
    const nextRemoteRuntimeId = 'repo-runtime-123456789012345678901'
    seedRepoWithReadModelForTest({ id: REMOTE_REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: nextRemoteRuntimeId,
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': () => remoteEnsure.promise,
      'workspace.runtimeOpen': async () => ({ ok: true, workspaceRuntimeId: 'repo-runtime-abcdefghijklmnopqrstu' }),
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(useWorkspacesStore.setState, useWorkspacesStore.getState)
    await vi.waitFor(() => {
      expect(useWorkspacesStore.getState().workspaces[REMOTE_REPO_ROOT]?.workspaceRuntimeId).toBe(nextRemoteRuntimeId)
    })

    await expect(
      openWorkspaceRuntimeWithCache(workspaceIdForTest('goblin+file:///tmp/unrelated-runtime')),
    ).resolves.toBe('repo-runtime-abcdefghijklmnopqrstu')
    await expect(recovery).resolves.toMatchObject({ kind: 'settled' })

    remoteEnsure.resolve({ kind: 'superseded', workspaceId: REMOTE_REPO_ROOT })
  })
})
