// @vitest-environment jsdom

import {
  createGitWorkspaceProbeForTest,
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { reconcileOpenWorkspaceRuntimeMemberships } from '#/web/stores/workspaces/workspace-runtime-membership-recovery.ts'
import {
  closeWorkspaceRuntimeWithCache,
  openWorkspaceRuntimeWithCache,
} from '#/web/stores/workspaces/workspace-session-write-paths.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { normalizeRemoteTarget, type RemoteWorkspaceLifecycleCommandResult } from '#/shared/remote-workspace.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { CodedError } from '#/shared/coded-error.ts'
import {
  acceptRemoteWorkspaceLifecycleProjection,
  acceptRemoteWorkspaceRuntimeProjection,
} from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'

vi.mock('#/web/stores/workspaces/workspace-refresh-command.ts', () => ({
  runWorkspaceRefresh: vi.fn(async () => ({ ok: true })),
}))

const REPO_ROOT = workspaceIdForTest('goblin+file:///tmp/runtime-membership-recovery')
const SECOND_REPO_ROOT = workspaceIdForTest('goblin+file:///tmp/second-runtime-membership-recovery')
const REMOTE_REPO_ROOT = workspaceIdForTest('goblin+ssh://example/srv/runtime-membership-recovery')
const REMOTE_TARGET = normalizeRemoteTarget({
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/srv/runtime-membership-recovery',
})
if (!REMOTE_TARGET || REMOTE_TARGET.id !== REMOTE_REPO_ROOT) throw new Error('invalid remote target fixture')

describe('workspace runtime membership recovery', () => {
  beforeEach(() => {
    vi.mocked(runWorkspaceRefresh).mockClear()
    vi.mocked(runWorkspaceRefresh).mockResolvedValue({ ok: true })
    resetWorkspacesStore()
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: 'repo-runtime-123456789012345678901',
            workspaceProbe: { status: 'probing' as const },
          },
        ],
      }),
    })
  })

  test('atomically advances a current repo shell to the reconciled server epoch', async () => {
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })

    const result = await reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)

    expect(result).toEqual({
      kind: 'settled',
      targets: [{ workspaceId: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }],
    })
    const repo = workspacesStore.getState().workspaces[REPO_ROOT]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-123456789012345678901')
    expect(repo?.capability).toEqual({ kind: 'probing', probe: { status: 'probing' } })
    expect(runWorkspaceRefresh).toHaveBeenCalledOnce()
    expect(runWorkspaceRefresh).toHaveBeenCalledWith(
      { set: workspacesStore.setState, get: workspacesStore.getState },
      REPO_ROOT,
      { workspaceRuntimeId: 'repo-runtime-123456789012345678901' },
    )
  })

  test('does not refresh capability when reconnect keeps the current local epoch', async () => {
    resetWorkspacesStore()
    const workspace = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            workspaceProbe: createGitWorkspaceProbeForTest(),
          },
        ],
      }),
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).resolves.toMatchObject({ kind: 'settled' })

    expect(runWorkspaceRefresh).not.toHaveBeenCalled()
  })

  test('removes a local shell rejected by the canonical membership response', async () => {
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    workspacesStore.setState({ restoredWorkspaceId: REPO_ROOT })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({ runtimes: [] }),
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).resolves.toEqual({ kind: 'settled', targets: [] })

    expect(workspacesStore.getState().workspaces[REPO_ROOT]).toBeUndefined()
    expect(workspacesStore.getState().workspaceOrder).toEqual([])
    expect(workspacesStore.getState().restoredWorkspaceId).toBeNull()
    expect(runWorkspaceRefresh).not.toHaveBeenCalled()
  })

  test('keeps a concurrently replaced shell when the captured membership is rejected', async () => {
    const reconcileResponse = Promise.withResolvers<{ runtimes: [] }>()
    const reconcile = vi.fn(() => reconcileResponse.promise)
    const previous = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': reconcile,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    const replacement = { ...previous, workspaceRuntimeId: 'repo-runtime-concurrent-replacement-123' }
    workspacesStore.setState({ workspaces: { [REPO_ROOT]: replacement } })
    reconcileResponse.resolve({ runtimes: [] })

    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [] })
    expect(workspacesStore.getState().workspaces[REPO_ROOT]).toBe(replacement)
  })

  test('applies canonical membership rejection when the later runtime snapshot refresh fails', async () => {
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({ runtimes: [] }),
      'workspace.runtimeList': async () => {
        throw new Error('runtime snapshot unavailable')
      },
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).rejects.toThrow('runtime snapshot unavailable')
    expect(workspacesStore.getState().workspaces[REPO_ROOT]).toBeUndefined()
  })

  test('keeps membership authoritative but fails recovery when the one-shot local refresh fails', async () => {
    vi.mocked(runWorkspaceRefresh).mockResolvedValue({
      ok: false,
      kind: 'failed',
      message: 'error.workspace-operation-failed',
    })
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).rejects.toThrow('error.workspace-operation-failed')
    expect(runWorkspaceRefresh).toHaveBeenCalledOnce()
  })

  test('attempts every changed local target before reporting a one-shot Refresh failure', async () => {
    resetWorkspacesStore()
    vi.mocked(runWorkspaceRefresh).mockImplementation(async (_, workspaceId) => {
      if (workspaceId === SECOND_REPO_ROOT) throw new Error('probe transport failed')
      return { ok: true }
    })
    const firstWorkspace = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    const secondWorkspace = seedRepoWithReadModelForTest({ id: SECOND_REPO_ROOT, branches: [] })
    workspacesStore.setState({
      workspaces: { [REPO_ROOT]: firstWorkspace, [SECOND_REPO_ROOT]: secondWorkspace },
      workspaceOrder: [REPO_ROOT, SECOND_REPO_ROOT],
    })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: 'repo-runtime-first-123456789012345',
            workspaceProbe: { status: 'probing' as const },
          },
          {
            workspaceId: SECOND_REPO_ROOT,
            workspaceRuntimeId: 'repo-runtime-second-12345678901234',
            workspaceProbe: { status: 'probing' as const },
          },
        ],
      }),
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).rejects.toThrow('probe transport failed')
    expect(runWorkspaceRefresh).toHaveBeenCalledTimes(2)
  })

  test('waits for parallel changed local runtimes before reporting incomplete recovery', async () => {
    resetWorkspacesStore()
    const firstRefresh = Promise.withResolvers<{ ok: true }>()
    const secondRefresh = Promise.withResolvers<{ ok: false; kind: 'cancelled' }>()
    vi.mocked(runWorkspaceRefresh).mockImplementation((_, workspaceId) =>
      workspaceId === REPO_ROOT ? firstRefresh.promise : secondRefresh.promise,
    )
    const firstWorkspace = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    const secondWorkspace = seedRepoWithReadModelForTest({ id: SECOND_REPO_ROOT, branches: [] })
    workspacesStore.setState({
      workspaces: { [REPO_ROOT]: firstWorkspace, [SECOND_REPO_ROOT]: secondWorkspace },
      workspaceOrder: [REPO_ROOT, SECOND_REPO_ROOT],
    })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: 'repo-runtime-first-123456789012345',
            workspaceProbe: { status: 'probing' as const },
          },
          {
            workspaceId: SECOND_REPO_ROOT,
            workspaceRuntimeId: 'repo-runtime-second-12345678901234',
            workspaceProbe: { status: 'probing' as const },
          },
        ],
      }),
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => expect(runWorkspaceRefresh).toHaveBeenCalledTimes(2))

    firstRefresh.resolve({ ok: true })
    secondRefresh.resolve({ ok: false, kind: 'cancelled' })
    await expect(recovery).rejects.toThrow('cancelled')
  })

  test('projects the reconciled local probe without accepting a later runtime-list probe', async () => {
    const nextWorkspaceRuntimeId = 'repo-runtime-abcdefghijklmnopqrstu'
    const runtimeList = vi.fn(async () => ({
      runtimes: [
        {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: nextWorkspaceRuntimeId,
          workspaceProbe: { status: 'probing' as const },
        },
      ],
    }))
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: nextWorkspaceRuntimeId,
            workspaceProbe: createGitWorkspaceProbeForTest(),
          },
        ],
      }),
      'workspace.runtimeList': runtimeList,
    })

    await reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)

    expect(runtimeList).toHaveBeenCalledOnce()
    const repo = workspacesStore.getState().workspaces[REPO_ROOT]
    expect(repo?.workspaceRuntimeId).toBe(nextWorkspaceRuntimeId)
    expect(repo?.capability.kind).toBe('git')
    expect(repo?.capability.probe.status).toBe('ready')
  })

  test('redeclares the latest window membership when a repo closes during recovery', async () => {
    resetWorkspacesStore()
    const firstResponse = Promise.withResolvers<{
      runtimes: Array<{
        workspaceId: string
        workspaceRuntimeId: string
        workspaceProbe: { status: 'probing' }
      }>
    }>()
    const reconcile = vi.fn().mockReturnValueOnce(firstResponse.promise).mockResolvedValueOnce({ runtimes: [] })
    installGoblinTestBridge({ 'workspace.runtimeReconcile': reconcile })
    seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    workspacesStore.setState({ workspaces: {}, workspaceOrder: [] })
    firstResponse.resolve({
      runtimes: [
        {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: 'repo-runtime-123456789012345678901',
          workspaceProbe: { status: 'probing' },
        },
      ],
    })

    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [] })
    expect(reconcile).toHaveBeenNthCalledWith(1, expect.objectContaining({ workspaceIds: [REPO_ROOT] }))
    expect(reconcile).toHaveBeenNthCalledWith(2, expect.objectContaining({ workspaceIds: [] }))
  })

  test('preserves a surviving changed runtime when membership changes between declarations', async () => {
    resetWorkspacesStore()
    const firstResponse = Promise.withResolvers<{
      runtimes: Array<{
        workspaceId: string
        workspaceRuntimeId: string
        workspaceProbe: { status: 'probing' }
      }>
    }>()
    const firstWorkspace = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    const secondWorkspace = seedRepoWithReadModelForTest({ id: SECOND_REPO_ROOT, branches: [] })
    workspacesStore.setState({
      workspaces: { [REPO_ROOT]: firstWorkspace, [SECOND_REPO_ROOT]: secondWorkspace },
      workspaceOrder: [REPO_ROOT, SECOND_REPO_ROOT],
    })
    const nextWorkspaceRuntimeId = 'repo-runtime-123456789012345678901'
    const reconcile = vi
      .fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce({
        runtimes: [
          {
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: nextWorkspaceRuntimeId,
            workspaceProbe: { status: 'probing' as const },
          },
        ],
      })
    installGoblinTestBridge({ 'workspace.runtimeReconcile': reconcile })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    workspacesStore.setState({
      workspaces: { [REPO_ROOT]: firstWorkspace },
      workspaceOrder: [REPO_ROOT],
    })
    firstResponse.resolve({
      runtimes: [
        {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: nextWorkspaceRuntimeId,
          workspaceProbe: { status: 'probing' },
        },
        {
          workspaceId: SECOND_REPO_ROOT,
          workspaceRuntimeId: 'repo-runtime-second-12345678901234',
          workspaceProbe: { status: 'probing' },
        },
      ],
    })

    await expect(recovery).resolves.toMatchObject({
      kind: 'settled',
      targets: [{ workspaceId: REPO_ROOT, workspaceRuntimeId: nextWorkspaceRuntimeId }],
    })
    expect(runWorkspaceRefresh).toHaveBeenCalledOnce()
    expect(reconcile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ workspaceIds: [REPO_ROOT, SECOND_REPO_ROOT] }),
    )
    expect(reconcile).toHaveBeenNthCalledWith(2, expect.objectContaining({ workspaceIds: [REPO_ROOT] }))
  })

  test('serializes full-set recovery with explicit open membership commands', async () => {
    resetWorkspacesStore()
    const reconcileResponse = Promise.withResolvers<{ runtimes: [] }>()
    const runtimeOpen = vi.fn(async () => ({ ok: true, workspaceRuntimeId: 'repo-runtime-123456789012345678901' }))
    installGoblinTestBridge({
      'workspace.runtimeReconcile': () => reconcileResponse.promise,
      'workspace.runtimeOpen': runtimeOpen,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    const open = openWorkspaceRuntimeWithCache(REPO_ROOT)
    await Promise.resolve()
    expect(runtimeOpen).not.toHaveBeenCalled()

    reconcileResponse.resolve({ runtimes: [] })
    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [] })
    await expect(open).resolves.toBe('repo-runtime-123456789012345678901')
    expect(runtimeOpen).toHaveBeenCalledOnce()
  })

  test('serializes full-set recovery with explicit close membership commands', async () => {
    resetWorkspacesStore()
    const repo = seedRepoWithReadModelForTest({ id: REPO_ROOT, branches: [] })
    const reconcileResponse = Promise.withResolvers<{
      runtimes: Array<{
        workspaceId: string
        workspaceRuntimeId: string
        workspaceProbe: { status: 'probing' }
      }>
    }>()
    const runtimeClose = vi.fn(async () => ({ ok: true, released: true, runtimeClosed: true }))
    installGoblinTestBridge({
      'workspace.runtimeReconcile': () => reconcileResponse.promise,
      'workspace.runtimeClose': runtimeClose,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    const close = closeWorkspaceRuntimeWithCache(REPO_ROOT, repo.workspaceRuntimeId)
    await Promise.resolve()
    expect(runtimeClose).not.toHaveBeenCalled()

    reconcileResponse.resolve({
      runtimes: [
        {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          workspaceProbe: { status: 'probing' },
        },
      ],
    })
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
    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)

    await opening
    await recovery

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ workspaceIds: [REPO_ROOT] }))
  })

  test('keeps production local open acquire and shell commit inside one shared lease', async () => {
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
      'workspace.runtimeOpen': async () => ({
        ok: true,
        workspace: { id: REPO_ROOT },
        workspaceRuntimeId: 'repo-runtime-123456789012345678901',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      }),
      'workspace.runtimeReconcile': reconcile,
      'settings.addWorkspaceEntry': async () => ({
        openWorkspaceEntries: [{ id: REPO_ROOT }],
        workspacePaneTabsByTargetByWorkspace: {},
      }),
    })

    const opening = workspacesStore.getState().openWorkspaceMembership(REPO_ROOT)
    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)

    await expect(opening).resolves.toMatchObject({ ok: true, workspaceId: REPO_ROOT })
    await expect(recovery).resolves.toMatchObject({ kind: 'settled' })
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ workspaceIds: [REPO_ROOT] }))
  })

  test('keeps production remote open durable admission inside one shared lease', async () => {
    resetWorkspacesStore()
    const membershipWrite = Promise.withResolvers<{
      openWorkspaceEntries: Array<{ id: WorkspaceId }>
      workspacePaneTabsByTargetByWorkspace: Record<string, never>
    }>()
    const addWorkspaceEntry = vi.fn(() => membershipWrite.promise)
    const workspaceRuntimeId = 'repo-runtime-remote-open-123456789'
    const reconcile = vi.fn(async () => ({
      runtimes: [
        {
          workspaceId: REMOTE_REPO_ROOT,
          workspaceRuntimeId,
          workspaceProbe: createGitWorkspaceProbeForTest(),
          remoteLifecycle: { kind: 'ready' as const, attemptId: 1, target: REMOTE_TARGET },
        },
      ],
    }))
    installGoblinTestBridge({
      'workspace.runtimeOpen': async () => ({ ok: true, workspaceRuntimeId }),
      'settings.addWorkspaceEntry': addWorkspaceEntry,
      'workspace.runtimeReconcile': reconcile,
      'workspace.runtimeList': reconcile,
      'remote.lifecycle': async () => ({
        kind: 'settled' as const,
        workspaceId: REMOTE_REPO_ROOT,
        lifecycle: { kind: 'ready' as const, attemptId: 1, target: REMOTE_TARGET },
        workspaceProbe: createGitWorkspaceProbeForTest(),
      }),
    })

    const opening = workspacesStore.getState().openWorkspaceMembership({ id: REMOTE_REPO_ROOT })
    await vi.waitFor(() => expect(addWorkspaceEntry).toHaveBeenCalledOnce())
    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await Promise.resolve()
    expect(reconcile).not.toHaveBeenCalled()

    membershipWrite.resolve({
      openWorkspaceEntries: [{ id: REMOTE_REPO_ROOT }],
      workspacePaneTabsByTargetByWorkspace: {},
    })

    await expect(opening).resolves.toMatchObject({ ok: true, workspaceId: REMOTE_REPO_ROOT })
    await expect(recovery).resolves.toMatchObject({
      kind: 'settled',
      targets: [{ workspaceId: REMOTE_REPO_ROOT, workspaceRuntimeId }],
    })
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ workspaceIds: [REMOTE_REPO_ROOT] }))
  })

  test('bootstraps a changed remote epoch from the reconcile lifecycle and probe', async () => {
    resetWorkspacesStore()
    const nextRemoteRuntimeId = 'repo-runtime-123456789012345678901'
    const readyProbe = createGitWorkspaceProbeForTest()
    const remoteLifecycle = vi.fn()
    seedRepoWithReadModelForTest({ id: REMOTE_REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: nextRemoteRuntimeId,
            workspaceProbe: readyProbe,
            remoteLifecycle: { kind: 'ready' as const, attemptId: 2, target: REMOTE_TARGET },
          },
        ],
      }),
      'workspace.runtimeList': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: nextRemoteRuntimeId,
            workspaceProbe: { status: 'probing' as const },
            remoteLifecycle: { kind: 'ready' as const, attemptId: 2, target: REMOTE_TARGET },
          },
        ],
      }),
      'remote.lifecycle': remoteLifecycle,
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).resolves.toMatchObject({
      kind: 'settled',
      targets: [{ workspaceId: REMOTE_REPO_ROOT, workspaceRuntimeId: nextRemoteRuntimeId }],
    })

    const workspace = workspacesStore.getState().workspaces[REMOTE_REPO_ROOT]
    expect(workspace).toMatchObject({
      workspaceRuntimeId: nextRemoteRuntimeId,
      capability: { kind: 'git', probe: readyProbe },
      admission: {
        kind: 'remote',
        lifecycle: { kind: 'ready', target: REMOTE_TARGET },
        lifecycleAttemptId: 2,
      },
    })
    expect(remoteLifecycle).not.toHaveBeenCalled()
    expect(runWorkspaceRefresh).not.toHaveBeenCalled()
  })

  test('waits for one changed remote ensure before returning its projection target', async () => {
    resetWorkspacesStore()
    const remoteEnsure = Promise.withResolvers<RemoteWorkspaceLifecycleCommandResult>()
    const nextRemoteRuntimeId = 'repo-runtime-123456789012345678901'
    seedRepoWithReadModelForTest({ id: REMOTE_REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: nextRemoteRuntimeId,
            workspaceProbe: { status: 'probing' as const },
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': () => remoteEnsure.promise,
      'workspace.runtimeOpen': async () => ({ ok: true, workspaceRuntimeId: 'repo-runtime-abcdefghijklmnopqrstu' }),
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => {
      expect(workspacesStore.getState().workspaces[REMOTE_REPO_ROOT]?.workspaceRuntimeId).toBe(nextRemoteRuntimeId)
    })

    let recoverySettled = false
    void recovery.then(() => {
      recoverySettled = true
    })
    await expect(
      openWorkspaceRuntimeWithCache(workspaceIdForTest('goblin+file:///tmp/unrelated-runtime')),
    ).resolves.toBe('repo-runtime-abcdefghijklmnopqrstu')
    expect(recoverySettled).toBe(false)

    remoteEnsure.resolve({
      kind: 'settled',
      workspaceId: REMOTE_REPO_ROOT,
      lifecycle: { kind: 'ready', attemptId: 1, target: REMOTE_TARGET },
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    await expect(recovery).resolves.toMatchObject({
      kind: 'settled',
      targets: [{ workspaceId: REMOTE_REPO_ROOT, workspaceRuntimeId: nextRemoteRuntimeId }],
    })
  })

  test('omits a changed remote target when its one-shot ensure fails', async () => {
    resetWorkspacesStore()
    const nextRemoteRuntimeId = 'repo-runtime-123456789012345678901'
    const remoteLifecycle = vi.fn(async (): Promise<RemoteWorkspaceLifecycleCommandResult> => ({
      kind: 'settled',
      workspaceId: REMOTE_REPO_ROOT,
      lifecycle: { kind: 'failed', attemptId: 1, reason: 'unreachable', target: REMOTE_TARGET },
      workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
    }))
    seedRepoWithReadModelForTest({ id: REMOTE_REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: nextRemoteRuntimeId,
            workspaceProbe: { status: 'probing' as const },
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': remoteLifecycle,
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).resolves.toEqual({
      kind: 'settled',
      targets: [],
    })
    expect(remoteLifecycle).toHaveBeenCalledOnce()
  })

  test('does not restart or project an already-failed changed remote epoch', async () => {
    resetWorkspacesStore()
    const nextRemoteRuntimeId = 'repo-runtime-123456789012345678901'
    const remoteLifecycle = vi.fn()
    seedRepoWithReadModelForTest({ id: REMOTE_REPO_ROOT, branches: [] })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: nextRemoteRuntimeId,
            workspaceProbe: {
              status: 'unavailable' as const,
              reason: 'error.workspace-transport-unavailable' as const,
            },
            remoteLifecycle: { kind: 'failed' as const, attemptId: 1, reason: 'unreachable' as const },
          },
        ],
      }),
      'remote.lifecycle': remoteLifecycle,
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).resolves.toMatchObject({ kind: 'settled', targets: [] })
    expect(remoteLifecycle).not.toHaveBeenCalled()
  })

  test('waits for an unchanged remote ensure before completing recovery', async () => {
    resetWorkspacesStore()
    const remoteEnsure = Promise.withResolvers<RemoteWorkspaceLifecycleCommandResult>()
    const remoteLifecycle = vi.fn(() => remoteEnsure.promise)
    const workspace = seedRepoShellForTest({
      id: REMOTE_REPO_ROOT,
      remoteLifecycle: { kind: 'connecting' },
    })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            workspaceProbe: { status: 'probing' as const },
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': remoteLifecycle,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => expect(remoteLifecycle).toHaveBeenCalledOnce())
    let completed = false
    void recovery.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    remoteEnsure.resolve({
      kind: 'settled',
      workspaceId: REMOTE_REPO_ROOT,
      lifecycle: { kind: 'ready', attemptId: 1, target: REMOTE_TARGET },
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    await expect(recovery).resolves.toEqual({
      kind: 'settled',
      targets: [{ workspaceId: REMOTE_REPO_ROOT, workspaceRuntimeId: workspace.workspaceRuntimeId }],
    })
  })

  test('accepts a remote ensure superseded by a newer ready projection', async () => {
    resetWorkspacesStore()
    const remoteEnsure = Promise.withResolvers<RemoteWorkspaceLifecycleCommandResult>()
    const remoteLifecycle = vi.fn(() => remoteEnsure.promise)
    const workspace = seedRepoShellForTest({
      id: REMOTE_REPO_ROOT,
      remoteLifecycle: { kind: 'connecting' },
    })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            workspaceProbe: { status: 'probing' as const },
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': remoteLifecycle,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => expect(remoteLifecycle).toHaveBeenCalledOnce())
    expect(
      acceptRemoteWorkspaceRuntimeProjection(workspacesStore.setState, workspacesStore.getState, {
        workspaceId: REMOTE_REPO_ROOT,
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        workspaceProbe: createGitWorkspaceProbeForTest(),
        remoteLifecycle: { kind: 'ready', attemptId: 2, target: REMOTE_TARGET },
      }),
    ).toBe(true)
    remoteEnsure.resolve({
      kind: 'settled',
      workspaceId: REMOTE_REPO_ROOT,
      lifecycle: { kind: 'ready', attemptId: 1, target: REMOTE_TARGET },
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })

    await expect(recovery).resolves.toEqual({
      kind: 'settled',
      targets: [{ workspaceId: REMOTE_REPO_ROOT, workspaceRuntimeId: workspace.workspaceRuntimeId }],
    })
  })

  test('uses a newer failed projection after a remote ensure returns ready', async () => {
    resetWorkspacesStore()
    const remoteEnsure = Promise.withResolvers<RemoteWorkspaceLifecycleCommandResult>()
    const remoteLifecycle = vi.fn(() => remoteEnsure.promise)
    const workspace = seedRepoShellForTest({
      id: REMOTE_REPO_ROOT,
      remoteLifecycle: { kind: 'connecting' },
    })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            workspaceProbe: { status: 'probing' as const },
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': remoteLifecycle,
    })

    const recovery = reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState)
    await vi.waitFor(() => expect(remoteLifecycle).toHaveBeenCalledOnce())
    remoteEnsure.resolve({
      kind: 'settled',
      workspaceId: REMOTE_REPO_ROOT,
      lifecycle: { kind: 'ready', attemptId: 1, target: REMOTE_TARGET },
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    queueMicrotask(() => {
      expect(
        acceptRemoteWorkspaceLifecycleProjection(workspacesStore.setState, workspacesStore.getState, {
          workspaceId: REMOTE_REPO_ROOT,
          workspaceRuntimeId: workspace.workspaceRuntimeId,
          remoteLifecycle: { kind: 'failed', attemptId: 2, reason: 'unreachable', target: REMOTE_TARGET },
        }),
      ).toBe(true)
    })

    await expect(recovery).resolves.toEqual({ kind: 'settled', targets: [] })
    expect(workspacesStore.getState().workspaces[REMOTE_REPO_ROOT]?.admission).toMatchObject({
      kind: 'remote',
      lifecycle: { kind: 'failed', reason: 'unreachable', target: REMOTE_TARGET },
    })
  })

  test('reports an unchanged remote ensure transport uncertainty as incomplete recovery', async () => {
    resetWorkspacesStore()
    const workspace = seedRepoShellForTest({
      id: REMOTE_REPO_ROOT,
      remoteLifecycle: { kind: 'connecting' },
    })
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: REMOTE_REPO_ROOT,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            workspaceProbe: { status: 'probing' as const },
            remoteLifecycle: { kind: 'connecting', attemptId: 1 },
          },
        ],
      }),
      'remote.lifecycle': async () => {
        throw new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'remote ensure outcome uncertain' })
      },
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).rejects.toThrow('remote runtime recovery did not settle')
  })
})
