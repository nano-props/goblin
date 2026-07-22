import { beforeEach, describe, expect, test, vi } from 'vitest'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { WorkspaceTabsRestoreResponseSchema } from '#/shared/settings-response-schema.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const LOCAL_WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///other')
const REMOTE_WORKSPACE_ID = workspaceIdForTest('goblin+ssh://host/repo')

const mocks = vi.hoisted(() => ({
  acquireWorkspaceRuntimeLease: vi.fn(),
  releaseWorkspaceRuntimeMembershipLease: vi.fn(),
  isCurrentWorkspaceRuntimeMembership: vi.fn(),
  getServerWorkspaceState: vi.fn(),
  compareAndReplaceServerWorkspaceEntries: vi.fn(),
  confirmServerWorkspaceEntry: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteWorkspaceLifecycleWrite: vi.fn(),
  workspaceProbeStateForRuntime: vi.fn(),
  probeWorkspace: vi.fn(),
}))

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = {
  commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
}

vi.mock('#/server/modules/workspace-runtimes.ts', () => ({
  acquireWorkspaceRuntimeLease: mocks.acquireWorkspaceRuntimeLease,
  releaseWorkspaceRuntimeMembershipLease: mocks.releaseWorkspaceRuntimeMembershipLease,
  isCurrentWorkspaceRuntimeMembership: mocks.isCurrentWorkspaceRuntimeMembership,
  commitWorkspaceProbeState: vi.fn(() => true),
  workspaceProbeStateForRuntime: mocks.workspaceProbeStateForRuntime,
  runSerializedInitialWorkspaceProbe: vi.fn(async (input) => {
    const probe = await input.probe()
    await input.beforeCommit?.({ before: { status: 'probing' }, after: probe })
    return probe
  }),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerWorkspaceState: mocks.getServerWorkspaceState,
  compareAndReplaceServerWorkspaceEntries: mocks.compareAndReplaceServerWorkspaceEntries,
  confirmServerWorkspaceEntry: mocks.confirmServerWorkspaceEntry,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeWorkspace: mocks.probeWorkspace,
}))

vi.mock('#/server/modules/remote-workspace-lifecycle-write-paths.ts', () => ({
  runRemoteWorkspaceLifecycleWrite: mocks.runRemoteWorkspaceLifecycleWrite,
}))

function gitProbe() {
  return {
    status: 'ready' as const,
    name: 'repo',
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  }
}

function plainWorkspaceProbe() {
  return {
    ...gitProbe(),
    capabilities: { ...gitProbe().capabilities, git: { status: 'unavailable' as const } },
  }
}

describe('restoreWorkspaceTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireWorkspaceRuntimeLease.mockImplementation((_userId: string, workspaceId: string) => ({
      workspaceId,
      workspaceRuntimeId: 'repo-runtime-test',
      generation: 1,
    }))
    mocks.isCurrentWorkspaceRuntimeMembership.mockReturnValue(true)
    mocks.workspaceProbeStateForRuntime.mockReturnValue(gitProbe())
    mocks.probeWorkspace.mockResolvedValue(gitProbe())
    mocks.readRepoProjection.mockResolvedValue({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: '/repo' } }] },
      pullRequests: null,
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    })
    mocks.confirmServerWorkspaceEntry.mockImplementation(async () => ({
      matched: true,
      workspace: await mocks.getServerWorkspaceState.mock.results.at(-1)?.value,
    }))
  })

  test('probes + projects + restores tabs for a single repo', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'main',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 5, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.workspace).toMatchObject({
      entry: { id: 'goblin+file:///repo' },
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      name: 'repo',
    })
    expect(result.workspace.gitProjection).not.toBeNull()
    expect(result.snapshot).toEqual({ revision: 5, entries: [] })
    expect(mocks.probeWorkspace).not.toHaveBeenCalled()
    expect(mocks.acquireWorkspaceRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace-root' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
    })
  })

  test('repairs invalid deferred tab state before initializing the runtime scope', async () => {
    const staleTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'deleted-branch',
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [staleTargetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = {
      restoreTabs: vi.fn(async () => ({
        kind: 'restored' as const,
        snapshot: { revision: 0, entries: [] },
        repaired: false,
      })),
      listWorkspaceTabs: vi.fn(),
      replaceTabs: vi.fn(async () => ({ revision: 5, entries: [] })),
      updateTabs: vi.fn(),
    }

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.snapshot).toEqual({ revision: 0, entries: [] })
    expect(result.workspace.gitProjection).not.toBeNull()
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace-root' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
    })
  })

  test('restores workspace tabs for a lazy local plain workspace without reading a Git projection', async () => {
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.workspaceProbeStateForRuntime.mockReturnValue({ status: 'probing' })
    mocks.probeWorkspace.mockResolvedValue(plainWorkspaceProbe())
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.workspace).toMatchObject({ gitProjection: null, workspaceProbe: { status: 'ready' } })
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.commitGitCapabilityRemoval).toHaveBeenCalledWith({
      userId: 'user-test',
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      assertCurrent: expect.any(Function),
    })
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.commitGitCapabilityRemoval).toHaveBeenCalledOnce()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace-root' }],
    })
  })

  test('restores workspace-root tabs while Git layout remains deferred after an operational diagnostic', async () => {
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.workspaceProbeStateForRuntime.mockReturnValue({
      ...plainWorkspaceProbe(),
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.commitGitCapabilityRemoval).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace-root' }],
    })
    expect(result.snapshot).toEqual({ revision: 0, entries: [] })
  })

  test('restores workspace tabs for a lazy remote plain workspace', async () => {
    const entry = { id: REMOTE_WORKSPACE_ID }
    const remoteTarget = {
      id: REMOTE_WORKSPACE_ID,
      alias: 'host',
      remotePath: '/repo',
      displayName: 'repo',
      host: 'example.test',
      user: 'tester',
      port: 22,
    }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [entry],
    })
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'ready', target: remoteTarget },
      name: 'repo',
    })
    mocks.workspaceProbeStateForRuntime.mockReturnValue(plainWorkspaceProbe())
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: entry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.workspace.gitProjection).toBeNull()
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: entry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: entry,
      targets: [{ kind: 'workspace-root' }],
    })
  })

  test('throws workspace-runtime-stale when clientId/workspaceRuntimeId does not match the active lease', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.isCurrentWorkspaceRuntimeMembership.mockReturnValue(false)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    await expect(
      restoreWorkspaceTabs({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: 'stale-runtime',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
    expect(mocks.probeWorkspace).not.toHaveBeenCalled()
  })

  test('rejects lazy restore when the repo is absent from server workspace membership', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: OTHER_WORKSPACE_ID }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    await expect(
      restoreWorkspaceTabs({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.workspace-not-in-session' })
    expect(mocks.getServerWorkspaceState).toHaveBeenCalledOnce()
  })

  test('rejects lazy restore when the repo is closed during projection', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    })
    mocks.confirmServerWorkspaceEntry.mockResolvedValue({
      matched: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    workspacePaneTabsHost.restoreTabs.mockResolvedValue({ kind: 'membership-conflict' })

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    await expect(
      restoreWorkspaceTabs({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.workspace-not-in-session' })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledOnce()
  })

  test('rejects lazy restore when aggregate validation observes removed membership', async () => {
    const entry = { id: LOCAL_WORKSPACE_ID }
    const workspace = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [entry] }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.confirmServerWorkspaceEntry.mockResolvedValue({
      matched: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    workspacePaneTabsHost.restoreTabs.mockResolvedValue({ kind: 'membership-conflict' })

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    await expect(
      restoreWorkspaceTabs({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.workspace-not-in-session' })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledOnce()
  })

  test('does not repair pane tabs after repo membership is removed', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch',
      workspaceId: LOCAL_WORKSPACE_ID,
      branchName: 'deleted',
    })
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.confirmServerWorkspaceEntry.mockResolvedValue({
      matched: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    workspacePaneTabsHost.restoreTabs.mockResolvedValue({ kind: 'membership-conflict' })

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    await expect(
      restoreWorkspaceTabs({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.workspace-not-in-session' })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledOnce()
  })

  test('keeps the existing membership and restores root tabs when lazy local Git projection fails', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })
    expect(result.workspace).toMatchObject({ workspaceId: LOCAL_WORKSPACE_ID, gitProjection: null })
    expect(result.snapshot).toEqual({ revision: 0, entries: [] })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: LOCAL_WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: { id: LOCAL_WORKSPACE_ID },
      targets: [{ kind: 'workspace-root' }],
    })
    expect(mocks.acquireWorkspaceRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('keeps the existing membership and restores root tabs when lazy remote Git projection fails', async () => {
    const remoteEntry = { id: REMOTE_WORKSPACE_ID }
    const remoteTarget = {
      id: REMOTE_WORKSPACE_ID,
      alias: 'host',
      remotePath: '/repo',
      displayName: 'repo',
      host: 'example.test',
      user: 'tester',
      port: 22,
    }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    })
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'ready', attemptId: 3, target: remoteTarget },
      name: 'repo',
    })
    mocks.workspaceProbeStateForRuntime.mockReturnValue(gitProbe())
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: remoteEntry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(decodeWith(WorkspaceTabsRestoreResponseSchema)(result)).toEqual(result)
    expect(result.workspace).toMatchObject({
      workspaceId: remoteEntry.id,
      transport: { kind: 'ssh', lifecycle: { kind: 'ready', attemptId: 3, target: remoteTarget } },
      gitProjection: null,
    })
    expect(result.snapshot).toEqual({ revision: 0, entries: [] })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: remoteEntry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      expectedWorkspaceEntry: remoteEntry,
      targets: [{ kind: 'workspace-root' }],
    })
  })

  test('keeps the existing membership when lazy remote ensure fails', async () => {
    const remoteEntry = { id: REMOTE_WORKSPACE_ID }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    })
    mocks.runRemoteWorkspaceLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'failed', attemptId: 4, reason: 'unreachable' },
      name: 'repo',
    })
    mocks.workspaceProbeStateForRuntime.mockReturnValue({
      status: 'unavailable',
      reason: 'error.workspace-transport-unavailable',
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    const result = await restoreWorkspaceTabs({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: remoteEntry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })
    expect(result.workspace).toMatchObject({
      workspaceId: remoteEntry.id,
      workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
      transport: { kind: 'ssh', lifecycle: { kind: 'failed', attemptId: 4, reason: 'unreachable' } },
      gitProjection: null,
    })
    expect(result.snapshot).toBeNull()
    expect(mocks.acquireWorkspaceRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseWorkspaceRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('rejects a projection if the membership becomes stale while reading', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ id: LOCAL_WORKSPACE_ID }],
    })
    mocks.isCurrentWorkspaceRuntimeMembership
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreWorkspaceTabs } = await import('#/server/modules/workspace-tabs-restore.ts')
    await expect(
      restoreWorkspaceTabs({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        workspaceId: LOCAL_WORKSPACE_ID,
        workspaceRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
  })
})
