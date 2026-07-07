import { beforeEach, describe, expect, test, vi } from 'vitest'
import { localRepoSessionEntry, normalizeRemoteTarget, remoteRepoSessionEntry } from '#/shared/remote-repo.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { deriveConnectivity } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { repoRuntimeInstancesQueryKey } from '#/web/repo-runtime-query.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import type { RepoRuntimeInstancesSnapshot } from '#/shared/api-types.ts'
import {
  branchSnapshot,
  flushIpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/web/stores/repos/repo-session-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo session hydration', () => {
  test('hydrateRepoSession restores repositories through the same initial local refresh path without recent-repo side effects', async () => {
    const calls = installGoblin()

    await useReposStore
      .getState()
      .hydrateRepoSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry(REPO_B)], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_B)
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(calls.recent).toEqual([])
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A, REPO_B])
    })
  })

  test('hydrateRepoSession binds server runtime ids to the canonical repo root', async () => {
    const subdir = `${REPO_A}/src`
    const calls = installGoblin({
      probe: (path: string) => ({ ok: true, root: path === subdir ? REPO_A : path, name: 'repo-a' }),
    })

    await useReposStore.getState().hydrateRepoSession([localRepoSessionEntry(subdir)], REPO_A)

    expect(useReposStore.getState().repos[subdir]).toBeUndefined()
    const repo = useReposStore.getState().repos[REPO_A]
    expect(repo).toBeDefined()
    expect(repo?.instanceId).toMatch(/^repo-instance-/)
    const cached = primaryWindowQueryClient.getQueryData<RepoRuntimeInstancesSnapshot>(repoRuntimeInstancesQueryKey())
    expect(cached?.instances).toEqual([{ repoRoot: REPO_A, repoInstanceId: repo!.instanceId }])
    await vi.waitFor(() => {
      expect(calls.projection).toEqual([REPO_A])
    })
  })

  test('hydrateRepoSession uses cached repo data while the initial refresh runs', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      repoSnapshotCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
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
    let resolveSnapshot!: (value: { branches: BranchSnapshotInfo[]; current: string }) => void
    installGoblin({
      projection: () =>
        new Promise<{
          snapshot: { branches: BranchSnapshotInfo[]; current: string }
          status: never[]
          pullRequests: null
        }>((resolve) => {
          resolveSnapshot = (value) => resolve({ snapshot: value, status: [], pullRequests: null })
        }),
    })

    await useReposStore.getState().hydrateRepoSession([localRepoSessionEntry(REPO_A)], REPO_A)

    const cachedRepo = useReposStore.getState().repos[REPO_A]
    expect(cachedRepo?.name).toBe('cached-a')
    expect(
      cachedRepo ? readRepoBranchQueryProjection(cachedRepo)?.branches.map((b) => b.name) : null,
    ).toEqual(['cached'])
    expect(cachedRepo?.projection.source).toBe('cache')
    expect(cachedRepo?.dataLoads.repoReadModel.phase).toBe('refreshing')
    expect(cachedRepo?.projection.savedAt).toBe(savedAt)

    resolveSnapshot({ branches: [branchSnapshot('fresh')], current: 'fresh' })
    await flushIpc()

    await vi.waitFor(() => {
      const freshRepo = useReposStore.getState().repos[REPO_A]
      expect(freshRepo ? readRepoBranchQueryProjection(freshRepo)?.currentBranch : null).toBe('fresh')
      expect(freshRepo?.projection.source).toBe('fresh')
      expect(freshRepo?.dataLoads.repoReadModel.phase).toBe('idle')
      expect(freshRepo?.projection.savedAt).toBeNull()
    })
  })

  test('hydrateRepoSession exposes resolved cached repos before slower probes finish', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      repoSnapshotCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
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
    const probes = new Map<string, (value: { ok: true; root: string; name: string }) => void>()
    installGoblin({
      probe: (path: string) =>
        new Promise<{ ok: true; root: string; name: string }>((resolve) => {
          probes.set(path, resolve)
        }),
      projection: () =>
        new Promise<{
          snapshot: { branches: BranchSnapshotInfo[]; current: string }
          status: never[]
          pullRequests: null
        }>(() => {}),
    })

    const work = useReposStore
      .getState()
      .hydrateRepoSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry(REPO_B)], REPO_A)
    // Local hydrate is server-first: the repo becomes visible after
    // the server canonicalizes the input and returns the authoritative
    // repoInstanceId. A slower sibling must not block this repo's
    // cached projection from rendering.
    await vi.waitFor(() => {
      expect(probes.has(REPO_A)).toBe(true)
    })
    probes.get(REPO_A)?.({ ok: true, root: REPO_A, name: 'repo-a' })
    await flushIpc()

    await vi.waitFor(() => {
      const repo = useReposStore.getState().repos[REPO_A]
      expect(repo).toBeDefined()
      expect(repo ? readRepoBranchQueryProjection(repo)?.branches.map((b) => b.name) : null).toEqual([
        'cached',
      ])
      // Local repos read as 'connected' under deriveConnectivity; the
      // meaningful invariant is just that the repo stays in the store.
      expect(deriveConnectivity(repo!)).toBe('connected')
      expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
      expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    })

    await vi.waitFor(() => {
      expect(probes.has(REPO_B)).toBe(true)
    })
    probes.get(REPO_B)?.({ ok: true, root: REPO_B, name: 'repo-b' })
    await work

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
  })

  test('hydrateRepoSession leaves server-owned branch tab open-sets out of repo store', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      repoSnapshotCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
          data: {
            branches: [branchSnapshot('main')],
            currentBranch: 'main',
          },
          ui: {
            branchViewMode: 'all',
          },
        },
      },
    })
    const probes = new Map<string, (value: { ok: true; root: string; name: string }) => void>()
    installGoblin({
      probe: (path: string) =>
        new Promise<{ ok: true; root: string; name: string }>((resolve) => {
          probes.set(path, resolve)
        }),
      projection: () =>
        new Promise<{
          snapshot: { branches: BranchSnapshotInfo[]; current: string }
          status: never[]
          pullRequests: null
        }>(() => {}),
    })

    const work = useReposStore.getState().hydrateRepoSession([localRepoSessionEntry(REPO_A)], REPO_A, {
      workspacePaneRestoreState: {
        workspacePaneTabsByTargetByRepo: { [REPO_A]: { [branchTargetKey(REPO_A, 'main')]: [] } },
        preferredWorkspacePaneTabByTargetByRepo: { [REPO_A]: { [branchTargetKey(REPO_A, 'main')]: 'status' } },
      },
    })

    await vi.waitFor(() => {
      expect(probes.has(REPO_A)).toBe(true)
    })
    probes.get(REPO_A)?.({ ok: true, root: REPO_A, name: 'repo-a' })
    await work

    const repo = useReposStore.getState().repos[REPO_A]
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(repo?.projection.source).toBe('cache')
    expect(repo?.ui.preferredWorkspacePaneTabByTarget).toEqual({})
  })

  test('hydrateRepoSession keeps the restored repo when boot probing settles later', async () => {
    installGoblin()
    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (result.ok) useReposStore.setState({ restoredRepoId: result.id })

    await useReposStore.getState().hydrateRepoSession([localRepoSessionEntry(REPO_B)], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
  })

  test('hydrateRepoSession flips workspaceMembershipReady even when openRepoEntries is empty', async () => {
    // Regression: a session with zero open repos used to leave the boot
    // skeleton up forever because workspaceMembershipReady only flipped on the first
    // placeholder landing, and an empty restore has no placeholders.
    installGoblin()

    await useReposStore.getState().hydrateRepoSession([], null)

    expect(useReposStore.getState().order).toEqual([])
    expect(useReposStore.getState().restoredRepoId).toBeNull()
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
  })

  test('hydrateRepoSession promotes a remote repo to connected once the probe resolves', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    installGoblin({
      probe: (path: string) => ({ ok: true, root: path, name: 'repo' }),
    })

    await useReposStore.getState().hydrateRepoSession([remoteRepoSessionEntry(target!)], target!.id)

    // The derived connectivity naturally reads as 'connected' once
    // the lifecycle lands on `ready`. addResolvedRepo is the only
    // thing that sets `remote.lifecycle`, so this also confirms
    // the probe chain ran end-to-end.
    const repo = useReposStore.getState().repos[target!.id]
    expect(repo?.remote.lifecycle).toEqual({ kind: 'ready', target })
    expect(deriveConnectivity(repo!)).toBe('connected')
  })

  test('hydrateRepoSession fails when a persisted local repo cannot establish runtime authority', async () => {
    installGoblin()

    await expect(
      useReposStore
        .getState()
        .hydrateRepoSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry('/missing')], '/missing'),
    ).rejects.toThrow('session repo restore failed')

    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
    expect(useReposStore.getState().repos['/missing']).toBeUndefined()
  })

  test('hydrateRepoSession fails preferred workspace pane restore for a repo that never opens', async () => {
    installGoblin()

    await expect(
      useReposStore.getState().hydrateRepoSession([localRepoSessionEntry('/missing')], '/missing', {
        workspacePaneRestoreState: {
          workspacePaneTabsByTargetByRepo: {},
          preferredWorkspacePaneTabByTargetByRepo: {
            '/missing': { [branchTargetKey('/missing', 'main')]: 'files' },
          },
        },
      }),
    ).rejects.toThrow('session repo restore failed')

    expect(useReposStore.getState().repos['/missing']).toBeUndefined()
  })

  test('hydrateRepoSession joins pending probes before reporting workspace pane restore failure', async () => {
    let resolveRepoB!: () => void
    installGoblin({
      probe: async (path: string) => {
        if (path === REPO_B) {
          await new Promise<void>((resolve) => {
            resolveRepoB = resolve
          })
        }
        return { ok: true, root: path, name: path.split('/').at(-1) ?? path }
      },
    })

    let settled = false
    const work = useReposStore
      .getState()
      .hydrateRepoSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry(REPO_B)], REPO_A, {
        workspacePaneRestoreState: {
          workspacePaneTabsByTargetByRepo: {},
          preferredWorkspacePaneTabByTargetByRepo: {
            [REPO_A]: { [branchTargetKey(REPO_A, 'main')]: 'files' },
          },
        },
      })
      .finally(() => {
        settled = true
      })

    await vi.waitFor(() => {
      expect(useReposStore.getState().repos[REPO_A]).toBeDefined()
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveRepoB()
    await expect(work).rejects.toThrow('workspace pane preferred tab restore failed')
    expect(useReposStore.getState().repos[REPO_B]).toBeDefined()
  })

  test('hydrateRepoSession limits concurrent repo probes', async () => {
    let active = 0
    let maxActive = 0
    const resolvers: Array<() => void> = []
    const repos = Array.from({ length: 6 }, (_, index) => `/tmp/gbl-lifecycle-limit-${index}`)
    installGoblin({
      probe: async (path: string) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise<void>((resolve) => {
          resolvers.push(resolve)
        })
        active -= 1
        return { ok: true, root: path, name: path.split('/').at(-1) ?? path }
      },
    })

    const work = useReposStore.getState().hydrateRepoSession(repos.map(localRepoSessionEntry), null)
    await vi.waitFor(() => {
      expect(maxActive).toBe(4)
      expect(resolvers).toHaveLength(4)
    })

    resolvers.splice(0).forEach((resolve) => resolve())
    for (let i = 0; i < 20 && resolvers.length < 2; i += 1) await Promise.resolve()
    resolvers.splice(0).forEach((resolve) => resolve())
    await work

    expect(useReposStore.getState().order).toEqual(repos)
  })

  test('hydrateRepoSession restores remote target metadata for remote repos', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    installGoblin({
      probe: (path: string) => ({ ok: true, root: path, name: 'repo' }),
    })

    await useReposStore.getState().hydrateRepoSession([remoteRepoSessionEntry(target!)], target!.id)

    expect(useReposStore.getState().repos[target!.id]?.remote.lifecycle).toEqual({ kind: 'ready', target })
    expect(useReposStore.getState().restoredRepoId).toBe(target!.id)
  })

  test('hydrateRepoSession keeps resolved remote target metadata when remote probe reports a missing path', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    installGoblin({
      probe: () => ({ ok: false, message: 'path-missing' }),
    })

    await useReposStore.getState().hydrateRepoSession([remoteRepoSessionEntry(target!)], target!.id)

    // The lifecycle union owns the failure signal. The `availability`
    // mirror field is kept for refresh pipeline guards
    // (refresh.ts / refresh-coordinator.ts), but is not authoritative;
    // this assertion pins the union shape, not the mirror.
    expect(useReposStore.getState().repos[target!.id]).toMatchObject({
      id: target!.id,
      remote: {
        lifecycle: { kind: 'failed', reason: 'path-missing', target },
      },
    })
  })

  test('hydrateRepoSession does not resolve a failed remote target twice', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const calls = installGoblin({
      probe: () => ({ ok: false, message: 'unreachable' }),
    })

    await useReposStore.getState().hydrateRepoSession([remoteRepoSessionEntry(target!)], target!.id)

    expect(calls.resolveTarget).toEqual([{ alias: 'example', remotePath: '/srv/repo' }])
  })

  test('hydrateRepoSession stops processing probes when the signal is already aborted', async () => {
    let probeCalls = 0
    const pending: Array<() => void> = []
    installGoblin({
      probe: (path: string) => {
        probeCalls += 1
        return new Promise<{ ok: true; root: string; name: string }>((resolve) => {
          pending.push(() => resolve({ ok: true, root: path, name: path.split('/').at(-1) ?? path }))
        })
      },
    })
    const controller = new AbortController()
    controller.abort()

    await useReposStore
      .getState()
      .hydrateRepoSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry(REPO_B)], REPO_A, {
        signal: controller.signal,
      })

    // Server-first hydrate now establishes runtime authority before
    // inserting placeholders. An already-aborted boot run therefore
    // short-circuits before either placeholder or probe work starts.
    expect(useReposStore.getState().order).toEqual([])
    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
    // But the probe handler was never invoked because the abort check
    // fires before resolveRepoPath is called.
    expect(probeCalls).toBe(0)

    // The still-pending probe should not affect the store when it
    // eventually resolves — hydrateRepoSession already returned, so the
    // resolved target should not be applied.
    pending.splice(0).forEach((resolve) => resolve())
    await flushIpc()
    // The aborted canonical-open path is dropped without writing
    // any repo state.
    expect(useReposStore.getState().repos[REPO_A]?.remote.lifecycle).toBeUndefined()
    expect(useReposStore.getState().repos[REPO_B]?.remote.lifecycle).toBeUndefined()
  })

  test('hydrateRepoSession rolls back runtime-open when abort lands before placeholder commit', async () => {
    let releaseRuntimeOpen!: () => void
    let runtimeOpenResolved = false
    let runtimeCloseCount = 0
    installGoblin({
      'repo.runtimeOpen': async () => {
        await new Promise<void>((resolve) => {
          releaseRuntimeOpen = () => {
            runtimeOpenResolved = true
            resolve()
          }
        })
        return {
          ok: true as const,
          repo: { id: REPO_A, name: 'repo-a' },
          repoInstanceId: 'repo-instance-test',
        }
      },
      'repo.runtimeClose': async () => {
        runtimeCloseCount += 1
        return { ok: true as const, closed: true }
      },
    })
    const controller = new AbortController()
    const work = useReposStore.getState().hydrateRepoSession([localRepoSessionEntry(REPO_A)], REPO_A, {
      signal: controller.signal,
    })

    await vi.waitFor(() => {
      expect(releaseRuntimeOpen).toBeTypeOf('function')
    })
    controller.abort()
    releaseRuntimeOpen()
    await work

    expect(runtimeOpenResolved).toBe(true)
    expect(runtimeCloseCount).toBe(1)
    expect(useReposStore.getState().order).toEqual([])
    expect(useReposStore.getState().workspaceMembershipReady).toBe(false)
  })
})

function branchTargetKey(repoRoot: string, branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath: null })
}
