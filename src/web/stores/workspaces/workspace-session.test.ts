import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget, remoteWorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { tabOpenerScopeKey } from '#/web/stores/workspaces/tab-opener.ts'
import { createRepoBranch, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { removeWorkspaceRuntimeFromCache, workspaceRuntimesQueryKey } from '#/web/workspace-runtime-query.ts'
import type { WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { requireRemoteAdmissionForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { markRemoteLifecycleReady } from '#/web/stores/workspaces/availability.ts'
import { addResolvedWorkspace, addUnavailableWorkspace } from '#/web/stores/workspaces/workspace-session-write-paths.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
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
  test('does not carry Git capability authority into a replacement runtime that is unavailable', () => {
    const workspaceId = REPO_A
    const workspace = emptyWorkspace(workspaceId, 'Example workspace', 'workspace-runtime-old')
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      name: 'Example workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    })

    const result = addUnavailableWorkspace(
      { workspaces: { [workspaceId]: workspace }, repoSnapshotCache: {}, workspaceOrder: [workspaceId] },
      workspaceId,
      'Workspace is unavailable',
      'workspace-runtime-new',
    )

    expect(result.workspaces[workspaceId]).toMatchObject({
      workspaceRuntimeId: 'workspace-runtime-new',
      availability: { phase: 'unavailable', reason: 'Workspace is unavailable' },
      capability: { kind: 'probing', probe: { status: 'probing' } },
    })
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
    const workspace = emptyWorkspace(target.id, target.displayName, workspaceRuntimeId)
    workspace.session = { entry: remoteWorkspaceSessionEntry(target), projectionState: 'projected' }
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      name: target.displayName,
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    })
    markRemoteLifecycleReady(workspace, target)
    const workspaceId = workspaceIdForTest(target.id)

    const result = addResolvedWorkspace(
      { workspaces: { [workspaceId]: workspace }, repoSnapshotCache: {}, workspaceOrder: [workspaceId] },
      {
        id: workspaceId,
        name: target.displayName,
        target,
        workspaceProbe: {
          status: 'ready',
          name: target.displayName,
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

  test('ensureWorkspaceOpen opens the resolved repo, records it as recent, and starts initial local refresh', async () => {
    const calls = installGoblin()

    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (result.ok) useWorkspacesStore.setState({ restoredWorkspaceId: result.workspaceId })
    if (result.ok) await result.postOpenEffects

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([REPO_A])
    expect(useWorkspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    expect(calls.recent).toEqual([{ kind: 'local', id: REPO_A }])
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A])
    })
  })

  test('ensureWorkspaceOpen writes server runtime membership into the query cache', async () => {
    installGoblin()

    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    const cached = primaryWindowQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      {
        workspaceId: REPO_A,
        workspaceRuntimeId: useWorkspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId,
        workspaceProbe: expect.objectContaining({ status: 'ready' }),
      },
    ])
  })

  test('ensureWorkspaceOpen rolls back a newly opened runtime when shared membership persistence fails', async () => {
    installGoblin({
      'settings.addWorkspaceRepo': () => {
        throw new Error('workspace write failed')
      },
    })

    await expect(useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)).resolves.toEqual({
      ok: false,
      message: 'error.failed-read-repo',
    })
    expect(useWorkspacesStore.getState().workspaces[REPO_A]).toBeUndefined()
    expect(useWorkspacesStore.getState().workspaceOrder).not.toContain(REPO_A)
  })

  test('closeWorkspace keeps local state when shared membership persistence fails', async () => {
    installGoblin({
      'settings.removeWorkspaceRepo': () => {
        throw new Error('workspace write failed')
      },
    })
    await expect(useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)).resolves.toMatchObject({ ok: true })
    const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId

    await expect(useWorkspacesStore.getState().closeWorkspace(REPO_A)).resolves.toEqual({
      ok: false,
      message: 'error.failed-read-repo',
    })

    expect(useWorkspacesStore.getState().workspaces[REPO_A]?.workspaceRuntimeId).toBe(workspaceRuntimeId)
    expect(useWorkspacesStore.getState().workspaceOrder).toContain(REPO_A)
  })

  test('serializes close after an in-flight open for the same repo', async () => {
    const releaseAdd = Promise.withResolvers<void>()
    const workspaceRepos: string[] = []
    const removeWorkspaceRepo = vi.fn(({ repoRoot }: { repoRoot: string }) => {
      const index = workspaceRepos.indexOf(repoRoot)
      if (index !== -1) workspaceRepos.splice(index, 1)
      return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
    })
    installGoblin({
      'settings.addWorkspaceRepo': async ({ entry }: { entry: { id: string } }) => {
        await releaseAdd.promise
        workspaceRepos.push(entry.id)
        return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
      },
      'settings.removeWorkspaceRepo': removeWorkspaceRepo,
    })

    const opening = useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    await vi.waitFor(() => expect(useWorkspacesStore.getState().workspaces[REPO_A]).toBeUndefined())
    const closing = useWorkspacesStore.getState().closeWorkspace(REPO_A)
    expect(removeWorkspaceRepo).not.toHaveBeenCalled()
    releaseAdd.resolve()

    await expect(opening).resolves.toMatchObject({ ok: true, workspaceId: REPO_A })
    await expect(closing).resolves.toEqual({ ok: true })
    expect(workspaceRepos).toEqual([])
    expect(useWorkspacesStore.getState().workspaces[REPO_A]).toBeUndefined()
  })

  test('serializes reopen after an in-flight close for the same repo', async () => {
    const releaseRemove = Promise.withResolvers<void>()
    let blockRemove = false
    const workspaceRepos: string[] = []
    installGoblin({
      'settings.addWorkspaceRepo': ({ entry }: { entry: { id: string } }) => {
        if (!workspaceRepos.includes(entry.id)) workspaceRepos.push(entry.id)
        return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
      },
      'settings.removeWorkspaceRepo': async ({ repoRoot }: { repoRoot: string }) => {
        if (blockRemove) await releaseRemove.promise
        const index = workspaceRepos.indexOf(repoRoot)
        if (index !== -1) workspaceRepos.splice(index, 1)
        return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
      },
    })
    await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    blockRemove = true

    const closing = useWorkspacesStore.getState().closeWorkspace(REPO_A)
    const reopening = useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    releaseRemove.resolve()

    await expect(closing).resolves.toEqual({ ok: true })
    await expect(reopening).resolves.toMatchObject({ ok: true, workspaceId: REPO_A })
    expect(workspaceRepos).toEqual([REPO_A])
    expect(useWorkspacesStore.getState().workspaces[REPO_A]).toBeDefined()
  })

  test('ensureWorkspaceOpen reports recent-history write failures without rolling back the opened repo', async () => {
    installGoblin({
      'settings.addRecentWorkspace': () => {
        throw new Error('recent write failed')
      },
    })

    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    expect(result.ok ? await result.postOpenEffects : null).toEqual([
      { kind: 'recent-workspace', message: 'recent write failed' },
    ])
    expect(useWorkspacesStore.getState().workspaces[REPO_A]).toBeDefined()
    const cached = primaryWindowQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      {
        workspaceId: REPO_A,
        workspaceRuntimeId: useWorkspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId,
        workspaceProbe: expect.objectContaining({ status: 'ready' }),
      },
    ])
  })

  test('ensureWorkspaceOpen adds a repo to the open set without changing the active selection', async () => {
    const calls = installGoblin()

    const first = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useWorkspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(result).toMatchObject({ ok: true, workspaceId: REPO_B })
    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(useWorkspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A, REPO_B])
    })
  })

  test('ensureWorkspaceOpen opens without changing the restored repo', async () => {
    const calls = installGoblin()

    const first = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useWorkspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(useWorkspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A, REPO_B])
    })
  })

  test('ensureWorkspaceOpen still ensures the workspace is added to the open set', async () => {
    installGoblin()

    const first = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useWorkspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(Object.keys(useWorkspacesStore.getState().workspaces)).toEqual([REPO_A, REPO_B])
    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(useWorkspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
  })

  test('ensureWorkspaceOpen does not re-refresh an already-open repo with unchanged target', async () => {
    const calls = installGoblin()

    const first = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useWorkspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    const second = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_B)
    if (second.ok) useWorkspacesStore.setState({ restoredWorkspaceId: second.workspaceId })
    // Opening REPO_A again is a focus action: the repo is already
    // resolved and its data is coherent, so we skip the runtime projection
    // pipeline.
    const third = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (third.ok) useWorkspacesStore.setState({ restoredWorkspaceId: third.workspaceId })

    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([REPO_A, REPO_B])
    expect(useWorkspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A, REPO_B])
    })
  })
  test('initial refresh results from a closed workspace runtime do not overwrite a reopened repo', async () => {
    const snapshotResolvers: Array<(value: { branches: BranchSnapshotInfo[]; current: string }) => void> = []
    installGoblin({
      projection: () =>
        new Promise<{
          snapshot: { branches: BranchSnapshotInfo[]; current: string }
          pullRequests: null
        }>((resolve) => {
          snapshotResolvers.push((value) => resolve({ snapshot: value, pullRequests: null }))
        }),
    })

    const first = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useWorkspacesStore.setState({ restoredWorkspaceId: first.workspaceId })
    await vi.waitFor(() => {
      expect(snapshotResolvers).toHaveLength(1)
    })
    const firstToken = useWorkspacesStore.getState().workspaces[REPO_A]?.workspaceRuntimeId
    await useWorkspacesStore.getState().closeWorkspace(REPO_A)
    const second = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    if (second.ok) useWorkspacesStore.setState({ restoredWorkspaceId: second.workspaceId })
    const secondToken = useWorkspacesStore.getState().workspaces[REPO_A]?.workspaceRuntimeId
    await vi.waitFor(() => {
      expect(snapshotResolvers).toHaveLength(2)
    })

    snapshotResolvers[1]?.({ branches: [branchSnapshot('fresh')], current: 'fresh' })
    await flushIpc()

    expect(secondToken).not.toBe(firstToken)
    await vi.waitFor(() => {
      const repo = useWorkspacesStore.getState().workspaces[REPO_A]
      expect(repo ? readRepoBranchQueryProjection(repo)?.currentBranch : null).toBe('fresh')
    })

    snapshotResolvers[0]?.({ branches: [branchSnapshot('stale')], current: 'stale' })
    await flushIpc()

    {
      const repo = useWorkspacesStore.getState().workspaces[REPO_A]
      expect(repo ? readRepoBranchQueryProjection(repo)?.currentBranch : null).toBe('fresh')
    }
  })

  test('closeWorkspace removes the closed server runtime membership from the query cache', async () => {
    installGoblin()

    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId

    await useWorkspacesStore.getState().closeWorkspace(REPO_A)
    await vi.waitFor(() => {
      const cached = primaryWindowQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
      expect(cached?.runtimes).not.toContainEqual({ repoRoot: REPO_A, workspaceRuntimeId })
    })
  })

  test('runtime membership cache reconciles from the server when local removal misses', async () => {
    installGoblin()

    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(REPO_A)
    expect(result).toMatchObject({ ok: true, workspaceId: REPO_A })
    const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_A]!.workspaceRuntimeId
    primaryWindowQueryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), {
      runtimes: [
        { workspaceId: REPO_B, workspaceRuntimeId: 'repo-runtime-stale-cache', workspaceProbe: { status: 'probing' } },
      ],
    })

    await removeWorkspaceRuntimeFromCache({
      workspaceId: REPO_A,
      workspaceRuntimeId: 'repo-runtime-not-in-cache',
    })

    const cached = primaryWindowQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      { workspaceId: REPO_A, workspaceRuntimeId, workspaceProbe: expect.objectContaining({ status: 'ready' }) },
    ])
  })

  test('ensureWorkspaceOpen preserves remote target metadata for recent repos and later actions', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const calls = installGoblin({
      probe: (cwd: string) => ({ ok: true, root: cwd, name: 'repo' }),
    })

    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(target!))
    if (result.ok) await result.postOpenEffects

    expect(result).toMatchObject({ ok: true, workspaceId: target!.id })
    expect(requireRemoteAdmissionForTest(useWorkspacesStore.getState().workspaces[target!.id]).lifecycle).toEqual({
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
      useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(target!)),
    ).resolves.toMatchObject({
      ok: true,
      workspaceId: target!.id,
    })
    expect(calls.workspaceRepos).toEqual([remoteWorkspaceSessionEntry(target!)])
    expect(useWorkspacesStore.getState().workspaces[target!.id]).toBeDefined()
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
      name: string
      lifecycle: { kind: 'ready'; attemptId: number; target: NonNullable<typeof target> }
    }>()
    const calls = installGoblin({ 'remote.lifecycle': () => lifecycle.promise })

    const opening = useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(target!))
    await vi.waitFor(() => expect(calls.workspaceRepos).toEqual([remoteWorkspaceSessionEntry(target!)]))
    await expect(useWorkspacesStore.getState().closeWorkspace(target!.id)).resolves.toEqual({ ok: true })
    lifecycle.resolve({
      kind: 'settled',
      workspaceId: target!.id,
      name: target!.displayName,
      lifecycle: { kind: 'ready', attemptId: 1, target: target! },
    })

    await expect(opening).resolves.toEqual({ ok: false, message: 'error.failed-read-repo' })
    expect(calls.workspaceRepos).toEqual([])
    expect(useWorkspacesStore.getState().workspaces[target!.id]).toBeUndefined()
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
    await useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(target!))

    await expect(useWorkspacesStore.getState().retryRemoteWorkspaceConnection(target!.id)).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    })
  })

  test('ensureWorkspaceOpen uses the canonical remote name instead of a stale cached name', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'example:/',
    })
    expect(target).not.toBeNull()
    useWorkspacesStore.setState({
      repoSnapshotCache: {
        [target!.id]: {
          savedAt: Date.now(),
          name: 'example:/',
          data: {
            branches: [branchSnapshot('cached')],
            currentBranch: 'cached',
          },
          ui: {
            branchViewMode: 'all',
          },
        },
      },
    })
    installGoblin()

    const result = await useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(target!))

    expect(result).toMatchObject({ ok: true, workspaceId: target!.id })
    expect(useWorkspacesStore.getState().workspaces[target!.id]?.name).toBe('example:repo')
    await vi.waitFor(() => {
      const repo = useWorkspacesStore.getState().workspaces[target!.id]
      expect(repo ? readRepoBranchQueryProjection(repo)?.branches.map((branch) => branch.name) : null).toEqual([])
    })
  })

  test('ensureWorkspaceOpen refreshes when a remote target changes between opens', async () => {
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
      probe: (cwd: string) => ({ ok: true, root: cwd, name: 'repo' }),
      'remote.resolveTarget': () => {
        resolveCalls += 1
        return { target: resolveCalls === 1 ? oldTarget : newTarget }
      },
    })

    const first = await useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(oldTarget!))
    expect(first).toMatchObject({ ok: true, workspaceId: oldTarget!.id })
    expect(requireRemoteAdmissionForTest(useWorkspacesStore.getState().workspaces[oldTarget!.id]).lifecycle).toEqual({
      kind: 'ready',
      target: oldTarget,
    })

    // Second open with a different SSH host. The target update must
    // trigger a refresh — the previous build returned `changed: false`
    // for the in-place update, so this assertion would have failed.
    const calls = installGoblin({
      probe: (cwd: string) => ({ ok: true, root: cwd, name: 'repo' }),
      'remote.resolveTarget': () => ({ target: newTarget }),
    })
    const second = await useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(newTarget!))
    expect(second).toMatchObject({ ok: true, workspaceId: newTarget!.id })
    expect(requireRemoteAdmissionForTest(useWorkspacesStore.getState().workspaces[newTarget!.id]).lifecycle).toEqual({
      kind: 'ready',
      target: newTarget,
    })
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([newTarget!.id])
    })
  })

  test('closeWorkspace clears recorded tab openers scoped to that repo, but leaves other repos untouched', async () => {
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
    useWorkspacesStore.setState({
      workspaces: { [REPO_A]: repoA, [REPO_B]: repoB },
      workspaceOrder: [REPO_A, REPO_B],
      restoredWorkspaceId: REPO_A,
    })
    useWorkspacesStore
      .getState()
      .setTabOpener(
        tabOpenerScopeKey({ kind: 'git-branch', repoRoot: REPO_A, branchName: 'feature/a' }),
        'workspace-pane:changes',
        'workspace-pane:status',
      )
    useWorkspacesStore
      .getState()
      .setTabOpener(
        tabOpenerScopeKey({ kind: 'git-branch', repoRoot: REPO_B, branchName: 'feature/b' }),
        'workspace-pane:changes',
        'workspace-pane:status',
      )

    await useWorkspacesStore.getState().closeWorkspace(REPO_A)

    const openers = useWorkspacesStore.getState().tabOpenerIdentityByScope
    expect(
      openers[tabOpenerScopeKey({ kind: 'git-branch', repoRoot: REPO_A, branchName: 'feature/a' })],
    ).toBeUndefined()
    expect(
      openers[tabOpenerScopeKey({ kind: 'git-branch', repoRoot: REPO_B, branchName: 'feature/b' })]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:status')
  })

  test('closeWorkspace clears workspace navigation history scoped to that repo', async () => {
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
    useWorkspacesStore.setState({
      workspaces: { [REPO_A]: repoA, [REPO_B]: repoB },
      workspaceOrder: [REPO_A, REPO_B],
      restoredWorkspaceId: REPO_A,
    })
    useWorkspacesStore.getState().recordWorkspaceNavigation({ workspaceId: REPO_A, route: { kind: 'dashboard' } })
    useWorkspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: REPO_B,
      route: { kind: 'newWorktree', returnTo: '/repo/repo-b/dashboard' },
    })

    await useWorkspacesStore.getState().closeWorkspace(REPO_A)

    const history = useWorkspacesStore.getState().navigationHistoryByWorkspace
    expect(history[REPO_A]).toBeUndefined()
    expect(history[REPO_B]?.current).toEqual({
      workspaceId: REPO_B,
      route: { kind: 'newWorktree', returnTo: '/repo/repo-b/dashboard' },
    })
  })
})
