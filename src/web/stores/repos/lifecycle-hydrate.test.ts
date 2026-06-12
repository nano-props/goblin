import { beforeEach, describe, expect, test, vi } from 'vitest'
import { localRepoSessionEntry, normalizeRemoteTarget, remoteRepoSessionEntry } from '#/shared/remote-repo.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import {
  branchSnapshot,
  flushIpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/web/stores/repos/lifecycle-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo session hydration', () => {
  test('hydrateSession restores tabs through the same initial local refresh path without recent-repo side effects', async () => {
    const calls = installGoblin()

    await useReposStore
      .getState()
      .hydrateSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry(REPO_B)], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_B)
    expect(useReposStore.getState().sessionReady).toBe(true)
    expect(calls.recent).toEqual([])
    expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    await vi.waitFor(() => {
      expect(calls.status).toEqual([REPO_A, REPO_B])
    })
  })

  test('hydrateSession uses cached repo data while the initial refresh runs', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      restorableRepoCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
          data: {
            branches: [branchSnapshot('cached')],
            currentBranch: 'cached',
          },
          ui: {
            selectedBranch: 'cached',
            branchViewMode: 'all',
          },
        },
      },
    })
    let resolveSnapshot!: (value: { branches: BranchSnapshotInfo[]; current: string }) => void
    installGoblin({
      snapshot: () =>
        new Promise<{ branches: BranchSnapshotInfo[]; current: string }>((resolve) => {
          resolveSnapshot = resolve
        }),
    })

    await useReposStore.getState().hydrateSession([localRepoSessionEntry(REPO_A)], REPO_A)

    const cachedRepo = useReposStore.getState().repos[REPO_A]
    expect(cachedRepo?.name).toBe('cached-a')
    expect(cachedRepo?.data.branches.map((b) => b.name)).toEqual(['cached'])
    expect(cachedRepo?.ui.selectedBranch).toBe('cached')
    expect(cachedRepo?.projection.source).toBe('cache')
    expect(cachedRepo?.resources.snapshot.phase).toBe('refreshing')
    expect(cachedRepo?.projection.savedAt).toBe(savedAt)

    resolveSnapshot({ branches: [branchSnapshot('fresh')], current: 'fresh' })
    await flushIpc()

    await vi.waitFor(() => {
      const freshRepo = useReposStore.getState().repos[REPO_A]
      expect(freshRepo?.data.currentBranch).toBe('fresh')
      expect(freshRepo?.projection.source).toBe('fresh')
      expect(freshRepo?.resources.snapshot.phase).toBe('idle')
      expect(freshRepo?.projection.savedAt).toBeNull()
    })
  })

  test('hydrateSession exposes resolved cached repos before slower probes finish', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      restorableRepoCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
          data: {
            branches: [branchSnapshot('cached')],
            currentBranch: 'cached',
          },
          ui: {
            selectedBranch: 'cached',
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
      snapshot: () => new Promise<{ branches: BranchSnapshotInfo[]; current: string }>(() => {}),
    })

    const work = useReposStore
      .getState()
      .hydrateSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry(REPO_B)], REPO_A)
    // Placeholder tabs are inserted synchronously before any probe runs,
    // so REPO_A's cached projection is visible immediately.
    await vi.waitFor(() => {
      const cachedRepo = useReposStore.getState().repos[REPO_A]
      expect(cachedRepo?.projection.source).toBe('cache')
      expect(useReposStore.getState().activeId).toBe(REPO_A)
      expect(useReposStore.getState().sessionReady).toBe(true)
    })

    // Slow probe on REPO_B shouldn't block sessionReady or REPO_A's view.
    probes.get(REPO_A)?.({ ok: true, root: REPO_A, name: 'repo-a' })
    await flushIpc()

    await vi.waitFor(() => {
      expect(useReposStore.getState().repos[REPO_A]?.remote.connectivity).toBe('connected')
    })

    probes.get(REPO_B)?.({ ok: true, root: REPO_B, name: 'repo-b' })
    await work

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().sessionReady).toBe(true)
  })

  test('hydrateSession keeps a user-selected active repo when boot probing settles later', async () => {
    installGoblin()
    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (result.ok) useReposStore.getState().setActive(result.id)

    await useReposStore.getState().hydrateSession([localRepoSessionEntry(REPO_B)], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
  })

  test('hydrateSession restores unavailable repos as tabs', async () => {
    installGoblin()

    await useReposStore
      .getState()
      .hydrateSession([localRepoSessionEntry(REPO_A), localRepoSessionEntry('/missing')], '/missing')

    expect(useReposStore.getState().order).toEqual([REPO_A, '/missing'])
    expect(useReposStore.getState().activeId).toBe('/missing')
    expect(useReposStore.getState().repos['/missing']).toMatchObject({
      id: '/missing',
      name: 'missing',
      availability: { phase: 'unavailable', reason: 'missing' },
    })
  })

  test('hydrateSession limits concurrent repo probes', async () => {
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

    const work = useReposStore.getState().hydrateSession(repos.map(localRepoSessionEntry), null)
    for (let i = 0; i < 5 && resolvers.length < 4; i += 1) await Promise.resolve()

    expect(maxActive).toBe(4)
    expect(resolvers).toHaveLength(4)

    resolvers.splice(0).forEach((resolve) => resolve())
    for (let i = 0; i < 20 && resolvers.length < 2; i += 1) await Promise.resolve()
    resolvers.splice(0).forEach((resolve) => resolve())
    await work

    expect(useReposStore.getState().order).toEqual(repos)
  })

  test('hydrateSession restores remote target metadata for remote repos', async () => {
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

    await useReposStore.getState().hydrateSession([remoteRepoSessionEntry(target!)], target!.id)

    expect(useReposStore.getState().repos[target!.id]?.remote.target).toEqual(target)
    expect(useReposStore.getState().activeId).toBe(target!.id)
  })

  test('hydrateSession keeps resolved remote target metadata when remote probe reports a missing path', async () => {
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

    await useReposStore.getState().hydrateSession([remoteRepoSessionEntry(target!)], target!.id)

    expect(useReposStore.getState().repos[target!.id]).toMatchObject({
      id: target!.id,
      remote: { target },
      availability: { phase: 'unavailable', reason: 'path-missing' },
    })
  })

  test('hydrateSession does not resolve a failed remote target twice', async () => {
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

    await useReposStore.getState().hydrateSession([remoteRepoSessionEntry(target!)], target!.id)

    expect(calls.resolveTarget).toEqual([{ alias: 'example', remotePath: '/srv/repo' }])
  })
})
