import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ServerWorkspaceState } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'

const mocks = vi.hoisted(() => ({
  acquireRepoRuntimeLease: vi.fn(),
  releaseRepoRuntimeMembershipLease: vi.fn(),
  isCurrentRepoRuntimeMembership: vi.fn(),
  getServerWorkspaceState: vi.fn(),
  compareAndReplaceServerWorkspaceRepos: vi.fn(),
  confirmServerWorkspaceRepoEntry: vi.fn(),
  probeRepo: vi.fn(),
  readRepoProjection: vi.fn(),
  runRemoteLifecycleWrite: vi.fn(),
  workspaceProbeStateForRuntime: vi.fn(),
  probeWorkspace: vi.fn(),
}))

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = { removeGitScopedResources: vi.fn() }

vi.mock('#/server/modules/repo-runtimes.ts', () => ({
  acquireRepoRuntimeLease: mocks.acquireRepoRuntimeLease,
  releaseRepoRuntimeMembershipLease: mocks.releaseRepoRuntimeMembershipLease,
  isCurrentRepoRuntimeMembership: mocks.isCurrentRepoRuntimeMembership,
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
  compareAndReplaceServerWorkspaceRepos: mocks.compareAndReplaceServerWorkspaceRepos,
  confirmServerWorkspaceRepoEntry: mocks.confirmServerWorkspaceRepoEntry,
}))

vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  readRepoProjection: mocks.readRepoProjection,
}))

vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeWorkspace: mocks.probeWorkspace,
}))

vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runRemoteLifecycleWrite,
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

describe('restoreRepoTabsForRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireRepoRuntimeLease.mockImplementation((_userId: string, repoRoot: string) => ({
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      generation: 1,
    }))
    mocks.isCurrentRepoRuntimeMembership.mockReturnValue(true)
    mocks.workspaceProbeStateForRuntime.mockReturnValue(gitProbe())
    mocks.probeWorkspace.mockResolvedValue(gitProbe())
    mocks.probeRepo.mockImplementation(async (repoRoot: string) => ({ ok: true, root: repoRoot, name: 'repo' }))
    mocks.readRepoProjection.mockResolvedValue({
      snapshot: { current: 'main', branches: [{ name: 'main', worktree: { path: '/repo' } }] },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    })
    mocks.confirmServerWorkspaceRepoEntry.mockImplementation(async () => ({
      matched: true,
      workspace: await mocks.getServerWorkspaceState.mock.results.at(-1)?.value,
    }))
  })

  test('probes + projects + restores tabs for a single repo', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: 'goblin+file:///repo',
      branchName: 'main',
      worktreePath: null,
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///repo' }],
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

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    const result = await restoreRepoTabsForRepo({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.repo).toMatchObject({
      entry: { kind: 'local', id: 'goblin+file:///repo' },
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'repo-runtime-test',
      name: 'repo',
    })
    expect(result.repo.projection).not.toBeNull()
    expect(result.snapshot).toEqual({ revision: 5, entries: [] })
    expect(mocks.probeRepo).not.toHaveBeenCalled()
    expect(mocks.acquireRepoRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
    })
  })

  test('repairs invalid deferred tab state before initializing the runtime scope', async () => {
    const staleTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: 'goblin+file:///repo',
      branchName: 'deleted-branch',
      worktreePath: null,
    })
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///repo' }],
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

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    const result = await restoreRepoTabsForRepo({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.snapshot).toEqual({ revision: 0, entries: [] })
    expect(result.repo.projection).not.toBeNull()
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace' }, { kind: 'git-worktree', root: 'goblin+file:///repo' }],
    })
  })

  test('restores workspace tabs for a lazy local plain workspace without reading a Git projection', async () => {
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///repo' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.workspaceProbeStateForRuntime.mockReturnValue({ status: 'probing' })
    mocks.probeWorkspace.mockResolvedValue(plainWorkspaceProbe())
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    const result = await restoreRepoTabsForRepo({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.repo).toMatchObject({ projection: null, workspaceProbe: { status: 'ready' } })
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.removeGitScopedResources).toHaveBeenCalledWith({
      userId: 'user-test',
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      assertCurrent: expect.any(Function),
    })
    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.removeGitScopedResources).toHaveBeenCalledOnce()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
      targets: [{ kind: 'workspace' }],
    })
  })

  test('keeps Git layout deferred for a lazy workspace with an operational Git diagnostic', async () => {
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///repo' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.workspaceProbeStateForRuntime.mockReturnValue({
      ...plainWorkspaceProbe(),
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await restoreRepoTabsForRepo({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST.removeGitScopedResources).not.toHaveBeenCalled()
  })

  test('restores workspace tabs for a lazy remote plain workspace', async () => {
    const entry = {
      kind: 'remote' as const,
      id: 'goblin+ssh://host/repo',
      ref: { id: 'goblin+ssh://host/repo', alias: 'host', remotePath: '/repo', displayName: 'repo' },
    }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [entry],
    })
    mocks.runRemoteLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'ready', target: entry.ref },
      name: 'repo',
    })
    mocks.workspaceProbeStateForRuntime.mockReturnValue(plainWorkspaceProbe())
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    const result = await restoreRepoTabsForRepo({
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: entry.id,
      repoRuntimeId: 'repo-runtime-test',
      workspacePaneTabsHost,
    })

    expect(result.repo.projection).toBeNull()
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: entry.id,
      workspaceRuntimeId: 'repo-runtime-test',
      expectedRepoEntry: entry,
      targets: [{ kind: 'workspace' }],
    })
  })

  test('throws repo-runtime-stale when clientId/repoRuntimeId does not match the active lease', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///repo' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.isCurrentRepoRuntimeMembership.mockReturnValue(false)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: 'goblin+file:///repo',
        repoRuntimeId: 'stale-runtime',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
    expect(mocks.probeRepo).not.toHaveBeenCalled()
  })

  test('rejects lazy restore when the repo is absent from server workspace membership', async () => {
    const workspace: ServerWorkspaceState = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///other' }],
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: 'goblin+file:///repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(mocks.getServerWorkspaceState).toHaveBeenCalledOnce()
  })

  test('rejects lazy restore when the repo is closed during projection', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///repo' }],
    })
    mocks.confirmServerWorkspaceRepoEntry.mockResolvedValue({
      matched: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    workspacePaneTabsHost.restoreTabs.mockResolvedValue({ kind: 'membership-conflict' })

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: 'goblin+file:///repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledOnce()
  })

  test('rejects lazy restore when aggregate validation observes removed membership', async () => {
    const entry = { kind: 'local' as const, id: 'goblin+file:///repo' }
    const workspace = { ...defaultServerWorkspaceState(), openWorkspaceEntries: [entry] }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.confirmServerWorkspaceRepoEntry.mockResolvedValue({
      matched: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    workspacePaneTabsHost.restoreTabs.mockResolvedValue({ kind: 'membership-conflict' })

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: 'goblin+file:///repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledOnce()
  })

  test('does not repair pane tabs after repo membership is removed', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: 'goblin+file:///repo',
      branchName: 'deleted',
      worktreePath: null,
    })
    const workspace = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///repo' }],
      workspacePaneTabsByTargetByWorkspace: {
        'goblin+file:///repo': { [targetKey]: [workspacePaneStaticTabEntry('history')] },
      },
    }
    mocks.getServerWorkspaceState.mockResolvedValue(workspace)
    mocks.confirmServerWorkspaceRepoEntry.mockResolvedValue({
      matched: false,
      latestWorkspace: defaultServerWorkspaceState(),
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    workspacePaneTabsHost.restoreTabs.mockResolvedValue({ kind: 'membership-conflict' })

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: 'goblin+file:///repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledOnce()
  })

  test('keeps the existing membership when lazy local projection fails', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///repo' }],
    })
    mocks.readRepoProjection.mockResolvedValue({ snapshot: null })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: 'goblin+file:///repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
    expect(mocks.acquireRepoRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('keeps the existing membership when lazy remote ensure fails', async () => {
    const remoteEntry = {
      kind: 'remote' as const,
      id: 'goblin+ssh://host/repo',
      ref: { id: 'goblin+ssh://host/repo', alias: 'host', remotePath: '/repo', displayName: 'repo' },
    }
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [remoteEntry],
    })
    mocks.runRemoteLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      lifecycle: { kind: 'failed', reason: 'unreachable' },
      name: 'repo',
    })
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: remoteEntry.id,
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
    expect(mocks.acquireRepoRuntimeLease).not.toHaveBeenCalled()
    expect(mocks.releaseRepoRuntimeMembershipLease).not.toHaveBeenCalled()
  })

  test('rejects a projection if the membership becomes stale while reading', async () => {
    mocks.getServerWorkspaceState.mockResolvedValue({
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local', id: 'goblin+file:///repo' }],
    })
    mocks.isCurrentRepoRuntimeMembership
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()

    const { restoreRepoTabsForRepo } = await import('#/server/modules/repo-workspace-tabs-restore.ts')
    await expect(
      restoreRepoTabsForRepo({
        workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
        userId: 'user-test',
        clientId: 'client_test000000000000',
        repoRoot: 'goblin+file:///repo',
        repoRuntimeId: 'repo-runtime-test',
        workspacePaneTabsHost,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
    expect(workspacePaneTabsHost.replaceTabs).not.toHaveBeenCalled()
  })
})
