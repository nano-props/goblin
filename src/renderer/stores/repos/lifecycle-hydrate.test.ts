import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { BranchInfo } from '#/renderer/types.ts'
import {
  branch,
  flushRpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/renderer/stores/repos/lifecycle-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo session hydration', () => {
  test('hydrateSession restores tabs through the same initial local refresh path without recent-repo side effects', async () => {
    const calls = installGoblin()

    await useReposStore.getState().hydrateSession([REPO_A, REPO_B], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_B)
    expect(useReposStore.getState().sessionReady).toBe(true)
    expect(calls.recent).toEqual([])
    expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    expect(calls.status).toEqual([REPO_A, REPO_B])
  })

  test('hydrateSession uses cached repo data while the initial refresh runs', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      repoCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
          data: {
            branches: [branch('cached')],
            currentBranch: 'cached',
            status: [],
            statusLoaded: true,
          },
          ui: {
            selectedBranch: 'cached',
            branchViewMode: 'all',
            detailTab: 'status',
          },
        },
      },
    })
    let resolveSnapshot!: (value: { branches: BranchInfo[]; current: string }) => void
    installGoblin({
      snapshot: () =>
        new Promise<{ branches: BranchInfo[]; current: string }>((resolve) => {
          resolveSnapshot = resolve
        }),
    })

    await useReposStore.getState().hydrateSession([REPO_A], REPO_A)

    const cachedRepo = useReposStore.getState().repos[REPO_A]
    expect(cachedRepo?.name).toBe('cached-a')
    expect(cachedRepo?.data.branches.map((b) => b.name)).toEqual(['cached'])
    expect(cachedRepo?.ui.selectedBranch).toBe('cached')
    expect(cachedRepo?.cache.source).toBe('cache')
    expect(cachedRepo?.async.refreshing).toBe(true)
    expect(cachedRepo?.cache.savedAt).toBe(savedAt)

    resolveSnapshot({ branches: [branch('fresh')], current: 'fresh' })
    await flushRpc()

    const freshRepo = useReposStore.getState().repos[REPO_A]
    expect(freshRepo?.data.currentBranch).toBe('fresh')
    expect(freshRepo?.cache.source).toBe('fresh')
    expect(freshRepo?.async.refreshing).toBe(false)
    expect(freshRepo?.cache.savedAt).toBeNull()
  })

  test('hydrateSession exposes resolved cached repos before slower probes finish', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      repoCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
          data: {
            branches: [branch('cached')],
            currentBranch: 'cached',
            status: [],
            statusLoaded: true,
          },
          ui: {
            selectedBranch: 'cached',
            branchViewMode: 'all',
            detailTab: 'status',
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
      snapshot: () => new Promise<{ branches: BranchInfo[]; current: string }>(() => {}),
    })

    const work = useReposStore.getState().hydrateSession([REPO_A, REPO_B], REPO_A)
    for (let i = 0; i < 5 && probes.size < 2; i += 1) await Promise.resolve()
    probes.get(REPO_A)?.({ ok: true, root: REPO_A, name: 'repo-a' })
    await flushRpc()

    const cachedRepo = useReposStore.getState().repos[REPO_A]
    expect(cachedRepo?.cache.source).toBe('cache')
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(useReposStore.getState().sessionReady).toBe(false)

    probes.get(REPO_B)?.({ ok: true, root: REPO_B, name: 'repo-b' })
    await work

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().sessionReady).toBe(true)
  })

  test('hydrateSession keeps a user-selected active repo when boot probing settles later', async () => {
    installGoblin()
    await useReposStore.getState().openRepo(REPO_A)

    await useReposStore.getState().hydrateSession([REPO_B], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
  })

  test('hydrateSession reports missing repos while restoring valid repos', async () => {
    installGoblin()

    await useReposStore.getState().hydrateSession([REPO_A, '/missing'], '/missing')

    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(useReposStore.getState().missingFromSession).toEqual([{ path: '/missing', reason: 'missing' }])
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

    const work = useReposStore.getState().hydrateSession(repos, null)
    for (let i = 0; i < 5 && resolvers.length < 4; i += 1) await Promise.resolve()

    expect(maxActive).toBe(4)
    expect(resolvers).toHaveLength(4)

    resolvers.splice(0).forEach((resolve) => resolve())
    for (let i = 0; i < 20 && resolvers.length < 2; i += 1) await Promise.resolve()
    resolvers.splice(0).forEach((resolve) => resolve())
    await work

    expect(useReposStore.getState().order).toEqual(repos)
  })
})
