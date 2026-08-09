import { seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget, remoteWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { tabOpenerScopeKey } from '#/web/stores/workspaces/tab-opener.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { removeWorkspaceRuntimeFromCache, workspaceRuntimesQueryKey } from '#/web/workspace-runtime-query.ts'
import type { WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { requireRemoteAdmissionForTest } from '#/web/stores/workspaces/git-workspace-client-state.test-utils.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { addResolvedWorkspace, insertPlaceholderWorkspace } from '#/web/stores/workspaces/workspace-session-state.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import {
  branchSnapshot,
  flushIpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/web/stores/workspaces/workspace-session-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo lifecycle', () => {
  test('creates a remote placeholder before its lifecycle resolves', () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'developer',
      port: 22,
      remotePath: '/srv/repo',
    })
    if (!target) throw new Error('expected normalized remote target')

    const result = insertPlaceholderWorkspace(
      { workspaces: {}, workspaceOrder: [] },
      remoteWorkspaceSessionEntry(target),
      'workspace-runtime-test',
    )

    expect(result.workspaces[target.id]).toMatchObject({ id: target.id, admission: { kind: 'remote' } })
  })

  test('accepts a capability change for an unchanged ready remote target', () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/workspace',
    })
    if (!target) throw new Error('expected normalized remote target')
    const workspaceRuntimeId = 'workspace-runtime-test'
    const workspace = emptyWorkspace(target.id, workspaceRuntimeId)
    workspace.session = { entry: remoteWorkspaceSessionEntry(target), projectionState: 'projected' }
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    })
    if (workspace.admission.kind !== 'remote') throw new Error('expected remote admission')
    workspace.admission.lifecycle = { kind: 'ready', target }
    const workspaceId = workspaceIdForTest(target.id)

    const result = addResolvedWorkspace(
      { workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] },
      {
        id: workspaceId,
        target,
        workspaceProbe: {
          status: 'ready',
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'unavailable' },
          },
          diagnostics: [],
        },
        session: { entry: remoteWorkspaceSessionEntry(target), projectionState: 'projected' },
      },
      workspaceRuntimeId,
    )

    expect(result.changed).toBe(true)
    expect(result.workspaces[target.id]?.capability.kind).toBe('filesystem')
    expect(requireRemoteAdmissionForTest(result.workspaces[target.id]).lifecycle).toEqual({ kind: 'ready', target })
  })

  test('openWorkspaceMembership opens the resolved repo, records it as recent, and starts initial local refresh', async () => {
    const calls = installGoblin()

    const result = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (result.ok) workspacesStore.setState({ restoredWorkspaceId: result.workspaceId })
    if (result.ok) await result.postOpenEffects

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    expect(workspacesStore.getState().workspaceOrder).toEqual([REPO_A])
    expect(workspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    expect(calls.recent).toEqual([{ id: REPO_A }])
    await vi.waitFor(() => {
      expect(calls.snapshot).toEqual([REPO_A])
    })
  })

  test('openWorkspaceMembership writes server runtime membership into the query cache', async () => {
    installGoblin()

    const result = await workspacesStore.getState().openWorkspaceMembership(REPO_A)

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    const cached = appQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      {
        workspaceId: REPO_A,
        workspaceRuntimeId: workspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId,
        workspaceProbe: expect.objectContaining({ status: 'ready' }),
      },
    ])
  })

  test('openWorkspaceMembership rolls back a newly opened runtime when shared membership persistence fails', async () => {
    installGoblin({
      'settings.addWorkspaceEntry': () => {
        throw new Error('workspace write failed')
      },
    })

    await expect(workspacesStore.getState().openWorkspaceMembership(REPO_A)).resolves.toEqual({
      ok: false,
      message: 'error.workspace-open-failed',
    })
    expect(workspacesStore.getState().workspaces[REPO_A]).toBeUndefined()
    expect(workspacesStore.getState().workspaceOrder).not.toContain(REPO_A)
  })

  test('closeWorkspace keeps local state when shared membership persistence fails', async () => {
    installGoblin({
      'settings.removeWorkspaceEntry': () => {
        throw new Error('workspace write failed')
      },
    })
    await expect(workspacesStore.getState().openWorkspaceMembership(REPO_A)).resolves.toMatchObject({ ok: true })
    const workspaceRuntimeId = workspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId

    await expect(workspacesStore.getState().closeWorkspace(REPO_A)).resolves.toEqual({
      ok: false,
      message: 'error.workspace-close-failed',
    })

    expect(workspacesStore.getState().workspaces[REPO_A]?.workspaceRuntimeId).toBe(workspaceRuntimeId)
    expect(workspacesStore.getState().workspaceOrder).toContain(REPO_A)
  })

  test('closing a filesystem workspace does not enter the Git operation lifecycle', async () => {
    installGoblin()
    const workspace = emptyWorkspace(REPO_A, 'workspace-runtime-filesystem')
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    workspacesStore.setState({ workspaces: { [REPO_A]: workspace }, workspaceOrder: [REPO_A] })

    await expect(workspacesStore.getState().closeWorkspace(REPO_A)).resolves.toEqual({ ok: true })
    expect(workspacesStore.getState().workspaces[REPO_A]).toBeUndefined()
  })

  test('serializes close after an in-flight open for the same repo', async () => {
    const releaseAdd = Promise.withResolvers<void>()
    const workspaceEntries: string[] = []
    const removeWorkspaceEntry = vi.fn(({ workspaceId }: { workspaceId: string }) => {
      const index = workspaceEntries.indexOf(workspaceId)
      if (index !== -1) workspaceEntries.splice(index, 1)
      return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
    })
    installGoblin({
      'settings.addWorkspaceEntry': async ({ entry }: { entry: { id: string } }) => {
        await releaseAdd.promise
        workspaceEntries.push(entry.id)
        return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
      },
      'settings.removeWorkspaceEntry': removeWorkspaceEntry,
    })

    const opening = workspacesStore.getState().openWorkspaceMembership(REPO_A)
    await vi.waitFor(() => expect(workspacesStore.getState().workspaces[REPO_A]).toBeUndefined())
    const closing = workspacesStore.getState().closeWorkspace(REPO_A)
    expect(removeWorkspaceEntry).not.toHaveBeenCalled()
    releaseAdd.resolve()

    await expect(opening).resolves.toMatchObject({ ok: true, workspaceId: REPO_A })
    await expect(closing).resolves.toEqual({ ok: true })
    expect(workspaceEntries).toEqual([])
    expect(workspacesStore.getState().workspaces[REPO_A]).toBeUndefined()
  })

  test('serializes reopen after an in-flight close for the same repo', async () => {
    const releaseRemove = Promise.withResolvers<void>()
    let blockRemove = false
    const workspaceEntries: string[] = []
    installGoblin({
      'settings.addWorkspaceEntry': ({ entry }: { entry: { id: string } }) => {
        if (!workspaceEntries.includes(entry.id)) workspaceEntries.push(entry.id)
        return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
      },
      'settings.removeWorkspaceEntry': async ({ workspaceId }: { workspaceId: string }) => {
        if (blockRemove) await releaseRemove.promise
        const index = workspaceEntries.indexOf(workspaceId)
        if (index !== -1) workspaceEntries.splice(index, 1)
        return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
      },
    })
    await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    blockRemove = true

    const closing = workspacesStore.getState().closeWorkspace(REPO_A)
    const reopening = workspacesStore.getState().openWorkspaceMembership(REPO_A)
    releaseRemove.resolve()

    await expect(closing).resolves.toEqual({ ok: true })
    await expect(reopening).resolves.toMatchObject({ ok: true, workspaceId: REPO_A })
    expect(workspaceEntries).toEqual([REPO_A])
    expect(workspacesStore.getState().workspaces[REPO_A]).toBeDefined()
  })

  test('openWorkspaceMembership reports recent-history write failures without rolling back the opened repo', async () => {
    installGoblin({
      'settings.addRecentWorkspace': () => {
        throw new Error('recent write failed')
      },
    })

    const result = await workspacesStore.getState().openWorkspaceMembership(REPO_A)

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    expect(result.ok ? await result.postOpenEffects : null).toEqual([
      { kind: 'recent-workspace', message: 'recent write failed' },
    ])
    expect(workspacesStore.getState().workspaces[REPO_A]).toBeDefined()
    const cached = appQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      {
        workspaceId: REPO_A,
        workspaceRuntimeId: workspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId,
        workspaceProbe: expect.objectContaining({ status: 'ready' }),
      },
    ])
  })

  test('openWorkspaceMembership adds a repo to the open set without changing the active selection', async () => {
    const calls = installGoblin()

    const first = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (first.ok) workspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    const result = await workspacesStore.getState().openWorkspaceMembership(REPO_B)

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_B })
    expect(workspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(workspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    })
  })

  test('openWorkspaceMembership opens without changing the restored repo', async () => {
    const calls = installGoblin()

    const first = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (first.ok) workspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    await workspacesStore.getState().openWorkspaceMembership(REPO_B)

    expect(workspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(workspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    })
  })

  test('openWorkspaceMembership still ensures the workspace is added to the open set', async () => {
    installGoblin()

    const first = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (first.ok) workspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    await workspacesStore.getState().openWorkspaceMembership(REPO_B)

    expect(Object.keys(workspacesStore.getState().workspaces)).toEqual([REPO_A, REPO_B])
    expect(workspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(workspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
  })

  test('openWorkspaceMembership does not re-refresh an already-open repo with unchanged target', async () => {
    const calls = installGoblin()

    const first = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (first.ok) workspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    const second = await workspacesStore.getState().openWorkspaceMembership(REPO_B)
    if (second.ok) workspacesStore.setState({ restoredWorkspaceId: second.workspaceId })
    // Opening REPO_A again is a focus action: the repo is already
    // resolved and its data is coherent, so we skip the runtime snapshot read.
    const third = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (third.ok) workspacesStore.setState({ restoredWorkspaceId: third.workspaceId })

    expect(workspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(workspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    })
  })
  test('initial refresh results from a closed workspace runtime do not overwrite a reopened repo', async () => {
    const snapshotResolvers: Array<(value: { branches: BranchSnapshotInfo[]; current: string }) => void> = []
    installGoblin({
      'repo.snapshot': () =>
        new Promise<{
          snapshot: {
            branches: BranchSnapshotInfo[]
            current: string
            remote: {
              remotes: []
              hasRemotes: false
              hasBrowserRemote: false
              remoteProviders: {}
              hasGitHubRemote: false
            }
          }
        }>((resolve) => {
          snapshotResolvers.push((value) =>
            resolve({
              snapshot: {
                ...value,
                remote: {
                  remotes: [],
                  hasRemotes: false,
                  hasBrowserRemote: false,
                  remoteProviders: {},
                  hasGitHubRemote: false,
                },
              },
            }),
          )
        }),
    })

    const first = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (first.ok) workspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    await vi.waitFor(() => {
      expect(snapshotResolvers).toHaveLength(1)
    })
    const firstToken = workspacesStore.getState().workspaces[REPO_A]?.workspaceRuntimeId
    await workspacesStore.getState().closeWorkspace(REPO_A)
    const second = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    if (second.ok) workspacesStore.setState({ restoredWorkspaceId: second.workspaceId })
    const secondToken = workspacesStore.getState().workspaces[REPO_A]?.workspaceRuntimeId
    await vi.waitFor(() => {
      expect(snapshotResolvers).toHaveLength(2)
    })

    snapshotResolvers[1]?.({ branches: [branchSnapshot('fresh')], current: 'fresh' })
    await flushIpc()

    expect(secondToken).not.toBe(firstToken)
    await vi.waitFor(() => {
      const repo = workspacesStore.getState().workspaces[REPO_A]
      expect(repo ? getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.current : null).toBe('fresh')
    })

    snapshotResolvers[0]?.({ branches: [branchSnapshot('stale')], current: 'stale' })
    await flushIpc()

    {
      const repo = workspacesStore.getState().workspaces[REPO_A]
      expect(repo ? getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.current : null).toBe('fresh')
    }
  })

  test('closeWorkspace removes the closed server runtime membership from the query cache', async () => {
    installGoblin()

    const result = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    const workspaceRuntimeId = workspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId

    await workspacesStore.getState().closeWorkspace(REPO_A)
    await vi.waitFor(() => {
      const cached = appQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
      expect(cached?.runtimes).not.toContainEqual({ workspaceId: REPO_A, workspaceRuntimeId })
    })
  })

  test('runtime membership cache reconciles from the server when local removal misses', async () => {
    installGoblin()

    const result = await workspacesStore.getState().openWorkspaceMembership(REPO_A)
    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    const workspaceRuntimeId = workspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId
    appQueryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), {
      runtimes: [
        { workspaceId: REPO_B, workspaceRuntimeId: 'repo-runtime-stale-cache', workspaceProbe: { status: 'probing' } },
      ],
    })

    await removeWorkspaceRuntimeFromCache({
      workspaceId: REPO_A,
      workspaceRuntimeId: 'repo-runtime-not-in-cache',
    })

    const cached = appQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      { workspaceId: REPO_A, workspaceRuntimeId, workspaceProbe: expect.objectContaining({ status: 'ready' }) },
    ])
  })

  test('openWorkspaceMembership preserves remote target metadata for recent repos and later actions', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const calls = installGoblin()

    const result = await workspacesStore.getState().openWorkspaceMembership(remoteWorkspaceSessionEntry(target!))
    if (result.ok) await result.postOpenEffects

    expect(result).toMatchObject({ ok: true, workspaceId: target!.id })
    expect(requireRemoteAdmissionForTest(workspacesStore.getState().workspaces[target!.id]).lifecycle).toEqual({
      kind: 'ready',
      target,
    })
    expect(calls.recent).toEqual([remoteWorkspaceSessionEntry(target!)])
  })

  test('keeps a remote workspace open when lifecycle transport is temporarily unavailable', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'developer',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const calls = installGoblin({
      'remote.lifecycle': () => {
        throw new Error('offline')
      },
    })

    await expect(
      workspacesStore.getState().openWorkspaceMembership(remoteWorkspaceSessionEntry(target!)),
    ).resolves.toMatchObject({
      ok: true,
      workspaceId: target!.id,
    })
    expect(calls.workspaceEntries).toEqual([remoteWorkspaceSessionEntry(target!)])
    expect(workspacesStore.getState().workspaces[target!.id]).toBeDefined()
  })

  test('does not resurrect a remote repo closed during lifecycle probing', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'developer',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const lifecycle = Promise.withResolvers<{
      kind: 'settled'
      workspaceId: string
      lifecycle: { kind: 'ready'; attemptId: number; target: NonNullable<typeof target> }
      workspaceProbe: {
        status: 'ready'
        capabilities: {
          files: { read: true; write: boolean }
          terminal: { available: boolean }
          git: { status: 'available'; worktrees: boolean; pullRequests: { provider: 'none' } }
        }
        diagnostics: []
      }
    }>()
    const calls = installGoblin({ 'remote.lifecycle': () => lifecycle.promise })

    const opening = workspacesStore.getState().openWorkspaceMembership(remoteWorkspaceSessionEntry(target!))
    await vi.waitFor(() => expect(calls.workspaceEntries).toEqual([remoteWorkspaceSessionEntry(target!)]))
    await expect(workspacesStore.getState().closeWorkspace(target!.id)).resolves.toEqual({ ok: true })
    lifecycle.resolve({
      kind: 'settled',
      workspaceId: target!.id,
      lifecycle: { kind: 'ready', attemptId: 1, target: target! },
      workspaceProbe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      },
    })

    await expect(opening).resolves.toEqual({ ok: false, message: 'error.workspace-open-failed' })
    expect(calls.workspaceEntries).toEqual([])
    expect(workspacesStore.getState().workspaces[target!.id]).toBeUndefined()
  })

  test('retryRemoteWorkspaceConnection returns a failure when the command transport fails', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'developer',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    installGoblin({
      'remote.lifecycle': () => {
        throw new Error('offline')
      },
    })
    await workspacesStore.getState().openWorkspaceMembership(remoteWorkspaceSessionEntry(target!))

    await expect(workspacesStore.getState().retryRemoteWorkspaceConnection(target!.id)).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    })
  })

  test('openWorkspaceMembership refreshes when a remote target changes between opens', async () => {
    const oldTarget = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    const newTarget = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.org',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(oldTarget).not.toBeNull()
    expect(newTarget).not.toBeNull()

    // The default IPC mock hardcodes the host by alias, so a same-alias
    // re-open would never see a target change. Override resolveTarget
    // to return oldTarget on the first call and newTarget on the second.
    let resolveCalls = 0
    installGoblin({
      'remote.resolveTarget': () => {
        resolveCalls += 1
        return { target: resolveCalls === 1 ? oldTarget : newTarget }
      },
    })

    const first = await workspacesStore.getState().openWorkspaceMembership(remoteWorkspaceSessionEntry(oldTarget!))
    expect(first).toMatchObject({ ok: true, workspaceId: oldTarget!.id })
    expect(requireRemoteAdmissionForTest(workspacesStore.getState().workspaces[oldTarget!.id]).lifecycle).toEqual({
      kind: 'ready',
      target: oldTarget,
    })

    // Second open with a different SSH host. The target update must
    // trigger a refresh — the previous build returned `changed: false`
    // for the in-place update, so this assertion would have failed.
    const calls = installGoblin({
      'remote.resolveTarget': () => ({ target: newTarget }),
    })
    const second = await workspacesStore.getState().openWorkspaceMembership(remoteWorkspaceSessionEntry(newTarget!))
    expect(second).toMatchObject({ ok: true, workspaceId: newTarget!.id })
    expect(requireRemoteAdmissionForTest(workspacesStore.getState().workspaces[newTarget!.id]).lifecycle).toEqual({
      kind: 'ready',
      target: newTarget,
    })
    await vi.waitFor(() => {
      expect(calls.snapshot).toEqual([newTarget!.id])
    })
  })

  test('closeWorkspace clears recorded tab openers scoped to that repo, but leaves other repos untouched', async () => {
    installGoblin()
    // seedRepoWithReadModelForTest replaces the whole `repos` map, so seed both repos
    // before merging them back together into one multi-repo store state.
    const repoA = seedRepoWithReadModelForTest({
      id: REPO_A,
      branches: [createRepoBranch('feature/a')],
      currentBranchName: 'feature/a',
    })
    const repoB = seedRepoWithReadModelForTest({
      id: REPO_B,
      branches: [createRepoBranch('feature/b')],
      currentBranchName: 'feature/b',
    })
    workspacesStore.setState({
      workspaces: { [REPO_A]: repoA, [REPO_B]: repoB },
      workspaceOrder: [REPO_A, REPO_B],
      restoredWorkspaceId: REPO_A,
    })
    workspacesStore
      .getState()
      .setTabOpener(
        tabOpenerScopeKey({ kind: 'git-branch', workspaceId: REPO_A, branchName: 'feature/a' }),
        'workspace-pane:changes',
        'workspace-pane:status',
      )
    workspacesStore
      .getState()
      .setTabOpener(
        tabOpenerScopeKey({ kind: 'git-branch', workspaceId: REPO_B, branchName: 'feature/b' }),
        'workspace-pane:changes',
        'workspace-pane:status',
      )

    await expect(workspacesStore.getState().closeWorkspace(REPO_A)).resolves.toEqual({ ok: true })

    const openers = workspacesStore.getState().tabOpenerIdentityByScope
    expect(
      openers[tabOpenerScopeKey({ kind: 'git-branch', workspaceId: REPO_A, branchName: 'feature/a' })],
    ).toBeUndefined()
    expect(
      openers[tabOpenerScopeKey({ kind: 'git-branch', workspaceId: REPO_B, branchName: 'feature/b' })]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:status')
  })

  test('closeWorkspace clears only terminal selections canonically owned by that Workspace', async () => {
    installGoblin()
    const workspaceA = seedRepoWithReadModelForTest({ id: REPO_A, branches: [] })
    const workspaceB = seedRepoWithReadModelForTest({ id: REPO_B, branches: [] })
    const keyA = formatTerminalFilesystemTargetKey(REPO_A, REPO_A)
    const keyB = formatTerminalFilesystemTargetKey(REPO_B, REPO_B)
    const malformedPrefixKey = `${REPO_A}\0not-a-workspace-locator`
    workspacesStore.setState({
      workspaces: { [REPO_A]: workspaceA, [REPO_B]: workspaceB },
      workspaceOrder: [REPO_A, REPO_B],
      restoredWorkspaceId: REPO_A,
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        [keyA]: 'terminal-session-a',
        [keyB]: 'terminal-session-b',
        [malformedPrefixKey]: 'terminal-session-malformed',
      },
    })

    await expect(workspacesStore.getState().closeWorkspace(REPO_A)).resolves.toEqual({ ok: true })

    expect(workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget).toEqual({
      [keyB]: 'terminal-session-b',
      [malformedPrefixKey]: 'terminal-session-malformed',
    })
  })

  test('closeWorkspace clears workspace navigation history scoped to that repo', async () => {
    installGoblin()
    const repoA = seedRepoWithReadModelForTest({
      id: REPO_A,
      branches: [createRepoBranch('feature/a')],
      currentBranchName: 'feature/a',
    })
    const repoB = seedRepoWithReadModelForTest({
      id: REPO_B,
      branches: [createRepoBranch('feature/b')],
      currentBranchName: 'feature/b',
    })
    workspacesStore.setState({
      workspaces: { [REPO_A]: repoA, [REPO_B]: repoB },
      workspaceOrder: [REPO_A, REPO_B],
      restoredWorkspaceId: REPO_A,
    })
    workspacesStore.getState().recordWorkspaceNavigation({ workspaceId: REPO_A, route: { kind: 'dashboard' } })
    workspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: REPO_B,
      route: { kind: 'newWorktree', returnTo: '/workspace/repo-b/dashboard' },
    })

    await expect(workspacesStore.getState().closeWorkspace(REPO_A)).resolves.toEqual({ ok: true })

    const history = workspacesStore.getState().navigationHistoryByWorkspace
    expect(history[REPO_A]).toBeUndefined()
    expect(history[REPO_B]?.current).toEqual({
      workspaceId: REPO_B,
      route: { kind: 'newWorktree', returnTo: '/workspace/repo-b/dashboard' },
    })
  })

  test('closeWorkspace clears only the branch view preference owned by that workspace', async () => {
    installGoblin()
    const repoA = seedRepoWithReadModelForTest({ id: REPO_A, branches: [] })
    const repoB = seedRepoWithReadModelForTest({ id: REPO_B, branches: [] })
    workspacesStore.setState({
      workspaces: { [REPO_A]: repoA, [REPO_B]: repoB },
      workspaceOrder: [REPO_A, REPO_B],
      restoredWorkspaceId: REPO_A,
      branchViewModeByWorkspace: { [REPO_A]: 'worktrees', [REPO_B]: 'worktrees' },
      restoredClientWorkspaceBaseline: {
        ...defaultClientWorkspaceState(),
        branchViewModeByWorkspace: { [REPO_A]: 'worktrees', [REPO_B]: 'worktrees' },
      },
    })

    await expect(workspacesStore.getState().closeWorkspace(REPO_A)).resolves.toEqual({ ok: true })

    expect(workspacesStore.getState().branchViewModeByWorkspace).toEqual({ [REPO_B]: 'worktrees' })
    expect(workspacesStore.getState().restoredClientWorkspaceBaseline?.branchViewModeByWorkspace).toEqual({
      [REPO_B]: 'worktrees',
    })
  })
})
