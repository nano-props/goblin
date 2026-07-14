import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget, remoteRepoSessionEntry } from '#/shared/remote-repo.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import { createRepoBranch, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { removeRepoRuntimeFromCache,  repoRuntimesQueryKey } from '#/web/repo-runtime-query.ts'
import type { RepoRuntimesSnapshot } from '#/shared/api-types.ts'
import {
  branchSnapshot,
  flushIpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/web/stores/repos/repo-session-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo lifecycle', () => {
  test('ensureWorkspaceOpen opens the resolved repo, records it as recent, and starts initial local refresh', async () => {
    const calls = installGoblin()

    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (result.ok) useReposStore.setState({ restoredRepoId: result.id })
    if (result.ok) await result.postOpenEffects

    expect(result).toMatchObject({ ok: true, id: REPO_A })
    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
    expect(calls.recent).toEqual([{ kind: 'local', id: REPO_A }])
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A])
    })
  })

  test('ensureWorkspaceOpen writes server runtime membership into the query cache', async () => {
    installGoblin()

    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)

    expect(result).toMatchObject({ ok: true, id: REPO_A })
    const cached = primaryWindowQueryClient.getQueryData<RepoRuntimesSnapshot>( repoRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      { repoRoot: REPO_A, repoRuntimeId: useReposStore.getState().repos[REPO_A]!.repoRuntimeId },
    ])
  })

  test('ensureWorkspaceOpen rolls back a newly opened runtime when shared membership persistence fails', async () => {
    installGoblin({
      'settings.addWorkspaceRepo': () => {
        throw new Error('workspace write failed')
      },
    })

    await expect(useReposStore.getState().ensureWorkspaceOpen(REPO_A)).resolves.toEqual({
      ok: false,
      message: 'error.failed-read-repo',
    })
    expect(useReposStore.getState().repos[REPO_A]).toBeUndefined()
    expect(useReposStore.getState().order).not.toContain(REPO_A)
  })

  test('closeRepo keeps local state when shared membership persistence fails', async () => {
    installGoblin({
      'settings.removeWorkspaceRepo': () => {
        throw new Error('workspace write failed')
      },
    })
    await expect(useReposStore.getState().ensureWorkspaceOpen(REPO_A)).resolves.toMatchObject({ ok: true })
    const repoRuntimeId = useReposStore.getState().repos[REPO_A]!.repoRuntimeId

    await expect(useReposStore.getState().closeRepo(REPO_A)).resolves.toEqual({
      ok: false,
      message: 'error.failed-read-repo',
    })

    expect(useReposStore.getState().repos[REPO_A]?.repoRuntimeId).toBe(repoRuntimeId)
    expect(useReposStore.getState().order).toContain(REPO_A)
  })

  test('serializes close after an in-flight open for the same repo', async () => {
    const releaseAdd = Promise.withResolvers<void>()
    const workspaceRepos: string[] = []
    const removeWorkspaceRepo = vi.fn(({ repoRoot }: { repoRoot: string }) => {
      const index = workspaceRepos.indexOf(repoRoot)
      if (index !== -1) workspaceRepos.splice(index, 1)
      return { openRepoEntries: [], workspacePaneTabsByTargetByRepo: {} }
    })
    installGoblin({
      'settings.addWorkspaceRepo': async ({ entry }: { entry: { id: string } }) => {
        await releaseAdd.promise
        workspaceRepos.push(entry.id)
        return { openRepoEntries: [], workspacePaneTabsByTargetByRepo: {} }
      },
      'settings.removeWorkspaceRepo': removeWorkspaceRepo,
    })

    const opening = useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    await vi.waitFor(() => expect(useReposStore.getState().repos[REPO_A]).toBeUndefined())
    const closing = useReposStore.getState().closeRepo(REPO_A)
    expect(removeWorkspaceRepo).not.toHaveBeenCalled()
    releaseAdd.resolve()

    await expect(opening).resolves.toMatchObject({ ok: true, id: REPO_A })
    await expect(closing).resolves.toEqual({ ok: true })
    expect(workspaceRepos).toEqual([])
    expect(useReposStore.getState().repos[REPO_A]).toBeUndefined()
  })

  test('serializes reopen after an in-flight close for the same repo', async () => {
    const releaseRemove = Promise.withResolvers<void>()
    let blockRemove = false
    const workspaceRepos: string[] = []
    installGoblin({
      'settings.addWorkspaceRepo': ({ entry }: { entry: { id: string } }) => {
        if (!workspaceRepos.includes(entry.id)) workspaceRepos.push(entry.id)
        return { openRepoEntries: [], workspacePaneTabsByTargetByRepo: {} }
      },
      'settings.removeWorkspaceRepo': async ({ repoRoot }: { repoRoot: string }) => {
        if (blockRemove) await releaseRemove.promise
        const index = workspaceRepos.indexOf(repoRoot)
        if (index !== -1) workspaceRepos.splice(index, 1)
        return { openRepoEntries: [], workspacePaneTabsByTargetByRepo: {} }
      },
    })
    await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    blockRemove = true

    const closing = useReposStore.getState().closeRepo(REPO_A)
    const reopening = useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    releaseRemove.resolve()

    await expect(closing).resolves.toEqual({ ok: true })
    await expect(reopening).resolves.toMatchObject({ ok: true, id: REPO_A })
    expect(workspaceRepos).toEqual([REPO_A])
    expect(useReposStore.getState().repos[REPO_A]).toBeDefined()
  })

  test('ensureWorkspaceOpen reports recent-history write failures without rolling back the opened repo', async () => {
    installGoblin({
      'settings.addRecentRepo': () => {
        throw new Error('recent write failed')
      },
    })

    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)

    expect(result).toMatchObject({ ok: true, id: REPO_A })
    expect(result.ok ? await result.postOpenEffects : null).toEqual([
      { kind: 'recent-repo', message: 'recent write failed' },
    ])
    expect(useReposStore.getState().repos[REPO_A]).toBeDefined()
    const cached = primaryWindowQueryClient.getQueryData<RepoRuntimesSnapshot>( repoRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([
      { repoRoot: REPO_A, repoRuntimeId: useReposStore.getState().repos[REPO_A]!.repoRuntimeId },
    ])
  })

  test('ensureWorkspaceOpen adds a repo to the open set without changing the active selection', async () => {
    const calls = installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.setState({ restoredRepoId: first.id })
    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(result).toMatchObject({ ok: true, id: REPO_B })
    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A, REPO_B])
    })
  })

  test('ensureWorkspaceOpen opens without changing the restored repo', async () => {
    const calls = installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.setState({ restoredRepoId: first.id })
    await useReposStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A, REPO_B])
    })
  })

  test('ensureWorkspaceOpen still ensures the workspace is added to the open set', async () => {
    installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.setState({ restoredRepoId: first.id })
    await useReposStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(Object.keys(useReposStore.getState().repos)).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
  })

  test('ensureWorkspaceOpen does not re-refresh an already-open repo with unchanged target', async () => {
    const calls = installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.setState({ restoredRepoId: first.id })
    const second = await useReposStore.getState().ensureWorkspaceOpen(REPO_B)
    if (second.ok) useReposStore.setState({ restoredRepoId: second.id })
    // Opening REPO_A again is a focus action: the repo is already
    // resolved and its data is coherent, so we skip the runtime projection
    // pipeline.
    const third = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (third.ok) useReposStore.setState({ restoredRepoId: third.id })

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A, REPO_B])
    })
  })
  test('initial refresh results from a closed repo runtime do not overwrite a reopened repo', async () => {
    const snapshotResolvers: Array<(value: { branches: BranchSnapshotInfo[]; current: string }) => void> = []
    installGoblin({
      projection: () =>
        new Promise<{
          snapshot: { branches: BranchSnapshotInfo[]; current: string }
          status: never[]
          pullRequests: null
        }>((resolve) => {
          snapshotResolvers.push((value) => resolve({ snapshot: value, status: [], pullRequests: null }))
        }),
    })

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.setState({ restoredRepoId: first.id })
    await vi.waitFor(() => {
      expect(snapshotResolvers).toHaveLength(1)
    })
    const firstToken = useReposStore.getState().repos[REPO_A]?.repoRuntimeId
    await useReposStore.getState().closeRepo(REPO_A)
    const second = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (second.ok) useReposStore.setState({ restoredRepoId: second.id })
    const secondToken = useReposStore.getState().repos[REPO_A]?.repoRuntimeId
    await vi.waitFor(() => {
      expect(snapshotResolvers).toHaveLength(2)
    })

    snapshotResolvers[1]?.({ branches: [branchSnapshot('fresh')], current: 'fresh' })
    await flushIpc()

    expect(secondToken).not.toBe(firstToken)
    await vi.waitFor(() => {
      const repo = useReposStore.getState().repos[REPO_A]
      expect(repo ? readRepoBranchQueryProjection(repo)?.currentBranch : null).toBe('fresh')
    })

    snapshotResolvers[0]?.({ branches: [branchSnapshot('stale')], current: 'stale' })
    await flushIpc()

    {
      const repo = useReposStore.getState().repos[REPO_A]
      expect(repo ? readRepoBranchQueryProjection(repo)?.currentBranch : null).toBe('fresh')
    }
  })

  test('closeRepo removes the closed server runtime membership from the query cache', async () => {
    installGoblin()

    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    expect(result).toMatchObject({ ok: true, id: REPO_A })
    const repoRuntimeId = useReposStore.getState().repos[REPO_A]!.repoRuntimeId

    await useReposStore.getState().closeRepo(REPO_A)
    await vi.waitFor(() => {
      const cached = primaryWindowQueryClient.getQueryData<RepoRuntimesSnapshot>( repoRuntimesQueryKey())
      expect(cached?.runtimes).not.toContainEqual({ repoRoot: REPO_A, repoRuntimeId })
    })
  })

  test('runtime membership cache reconciles from the server when local removal misses', async () => {
    installGoblin()

    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    expect(result).toMatchObject({ ok: true, id: REPO_A })
    const repoRuntimeId = useReposStore.getState().repos[REPO_A]!.repoRuntimeId
    primaryWindowQueryClient.setQueryData<RepoRuntimesSnapshot>( repoRuntimesQueryKey(), {
      runtimes: [{ repoRoot: REPO_B, repoRuntimeId: 'repo-runtime-stale-cache' }],
    })

    await removeRepoRuntimeFromCache({
      repoRoot: REPO_A,
      repoRuntimeId: 'repo-runtime-not-in-cache',
    })

    const cached = primaryWindowQueryClient.getQueryData<RepoRuntimesSnapshot>( repoRuntimesQueryKey())
    expect(cached?.runtimes).toEqual([{ repoRoot: REPO_A, repoRuntimeId }])
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

    const result = await useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(target!))
    if (result.ok) await result.postOpenEffects

    expect(result).toMatchObject({ ok: true, id: target!.id })
    expect(useReposStore.getState().repos[target!.id]?.remote.lifecycle).toEqual({ kind: 'ready', target })
    expect(calls.recent).toEqual([remoteRepoSessionEntry(target!)])
  })

  test('keeps a remote workspace open when lifecycle transport is temporarily unavailable', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example', host: 'example.com', user: 'developer', port: 22, remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const calls = installGoblin({
      'remote.lifecycle': () => {
        throw new Error('offline')
      },
    })

    await expect(
      useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(target!)),
    ).resolves.toMatchObject({ ok: true, id: target!.id })
    expect(calls.workspaceRepos).toEqual([remoteRepoSessionEntry(target!)])
    expect(useReposStore.getState().repos[target!.id]).toBeDefined()
  })

  test('does not resurrect a remote repo closed during lifecycle probing', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example', host: 'example.com', user: 'developer', port: 22, remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const lifecycle = Promise.withResolvers<{
      kind: 'settled'
      repoId: string
      name: string
      lifecycle: { kind: 'ready'; attemptId: number; target: NonNullable<typeof target> }
    }>()
    const calls = installGoblin({ 'remote.lifecycle': () => lifecycle.promise })

    const opening = useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(target!))
    await vi.waitFor(() => expect(calls.workspaceRepos).toEqual([remoteRepoSessionEntry(target!)]))
    await expect(useReposStore.getState().closeRepo(target!.id)).resolves.toEqual({ ok: true })
    lifecycle.resolve({
      kind: 'settled',
      repoId: target!.id,
      name: target!.displayName,
      lifecycle: { kind: 'ready', attemptId: 1, target: target! },
    })

    await expect(opening).resolves.toEqual({ ok: false, message: 'error.failed-read-repo' })
    expect(calls.workspaceRepos).toEqual([])
    expect(useReposStore.getState().repos[target!.id]).toBeUndefined()
  })

  test('retryRemoteRepoConnection returns a failure when the command transport fails', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example', host: 'example.com', user: 'developer', port: 22, remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    installGoblin({
      'remote.lifecycle': () => {
        throw new Error('offline')
      },
    })
    await useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(target!))

    await expect(useReposStore.getState().retryRemoteRepoConnection(target!.id)).resolves.toEqual({
      ok: false, reason: 'unknown',
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
    useReposStore.setState({
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

    const result = await useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(target!))

    expect(result).toMatchObject({ ok: true, id: target!.id })
    expect(useReposStore.getState().repos[target!.id]?.name).toBe('example:repo')
    await vi.waitFor(() => {
      const repo = useReposStore.getState().repos[target!.id]
      expect(
        repo ? readRepoBranchQueryProjection(repo)?.branches.map((branch) => branch.name) : null,
      ).toEqual([])
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

    const first = await useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(oldTarget!))
    expect(first).toMatchObject({ ok: true, id: oldTarget!.id })
    expect(useReposStore.getState().repos[oldTarget!.id]?.remote.lifecycle).toEqual({
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
    const second = await useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(newTarget!))
    expect(second).toMatchObject({ ok: true, id: newTarget!.id })
    expect(useReposStore.getState().repos[newTarget!.id]?.remote.lifecycle).toEqual({
      kind: 'ready',
      target: newTarget,
    })
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([newTarget!.id])
    })
  })

  test('closeRepo clears recorded tab openers scoped to that repo, but leaves other repos untouched', async () => {
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
    useReposStore.setState({
      repos: { [REPO_A]: repoA, [REPO_B]: repoB },
      order: [REPO_A, REPO_B],
      restoredRepoId: REPO_A,
    })
    useReposStore
      .getState()
      .setTabOpener(
        tabOpenerScopeKey({ repoRoot: REPO_A, branchName: 'feature/a', worktreePath: null }),
        'workspace-pane:changes',
        'workspace-pane:status',
      )
    useReposStore
      .getState()
      .setTabOpener(
        tabOpenerScopeKey({ repoRoot: REPO_B, branchName: 'feature/b', worktreePath: null }),
        'workspace-pane:changes',
        'workspace-pane:status',
      )

    await useReposStore.getState().closeRepo(REPO_A)

    const openers = useReposStore.getState().tabOpenerIdentityByScope
    expect(openers[tabOpenerScopeKey({ repoRoot: REPO_A, branchName: 'feature/a', worktreePath: null })]).toBeUndefined()
    expect(
      openers[tabOpenerScopeKey({ repoRoot: REPO_B, branchName: 'feature/b', worktreePath: null })]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:status')
  })

  test('closeRepo clears workspace navigation history scoped to that repo', async () => {
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
    useReposStore.setState({
      repos: { [REPO_A]: repoA, [REPO_B]: repoB },
      order: [REPO_A, REPO_B],
      restoredRepoId: REPO_A,
    })
    useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_A, route: { kind: 'dashboard' } })
    useReposStore.getState().recordWorkspaceNavigation({
      repoId: REPO_B,
      route: { kind: 'newWorktree', returnTo: '/repo/repo-b/dashboard' },
    })

    await useReposStore.getState().closeRepo(REPO_A)

    const history = useReposStore.getState().navigationHistoryByRepo
    expect(history[REPO_A]).toBeUndefined()
    expect(history[REPO_B]?.current).toEqual({
      repoId: REPO_B,
      route: { kind: 'newWorktree', returnTo: '/repo/repo-b/dashboard' },
    })
  })
})
