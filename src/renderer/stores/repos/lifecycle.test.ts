import { beforeEach, describe, expect, test } from 'bun:test'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { BranchInfo } from '#/renderer/types.ts'

const REPO_A = '/tmp/gbl-lifecycle-a'
const REPO_B = '/tmp/gbl-lifecycle-b'

function branch(name: string): BranchInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
  }
}

function installGbl(overrides: Partial<typeof window.gbl> = {}) {
  const calls = {
    recent: [] as string[],
    snapshot: [] as string[],
    status: [] as string[],
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      gbl: {
        probe: async (path: string) => {
          if (path === '/missing') return { ok: false, message: 'missing' }
          return { ok: true, root: path, name: path.split('/').at(-1) ?? path }
        },
        snapshot: async (id: string) => {
          calls.snapshot.push(id)
          return { branches: [], current: '' }
        },
        pullRequests: async () => [],
        status: async (id: string) => {
          calls.status.push(id)
          return []
        },
        abort: async () => undefined,
        settings: {
          addRecentRepo: async (id: string) => {
            calls.recent.push(id)
            return calls.recent
          },
        },
        ...overrides,
      },
    },
  })
  return calls
}

beforeEach(() => {
  useReposStore.setState({
    repos: {},
    order: [],
    activeId: null,
    sessionReady: false,
    missingFromSession: [],
    detailCollapsed: true,
  })
})

describe('repo lifecycle', () => {
  test('openRepo opens the resolved repo, records it as recent, and starts initial local refresh', async () => {
    const calls = installGbl()

    const result = await useReposStore.getState().openRepo(REPO_A)

    expect(result).toEqual({ ok: true, id: REPO_A })
    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.recent).toEqual([REPO_A])
    expect(calls.snapshot).toEqual([REPO_A])
    expect(calls.status).toEqual([REPO_A])
  })

  test('openRepo with activate false opens without changing the active repo', async () => {
    const calls = installGbl()

    await useReposStore.getState().openRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_B, { activate: false })

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    expect(calls.status).toEqual([REPO_A, REPO_B])
  })

  test('openRepo activates and locally refreshes an already-open repo', async () => {
    const calls = installGbl()

    await useReposStore.getState().openRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_B)
    await useReposStore.getState().openRepo(REPO_A)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.snapshot).toEqual([REPO_A, REPO_B, REPO_A])
    expect(calls.status).toEqual([REPO_A, REPO_B, REPO_A])
  })

  test('hydrateSession restores tabs through the same initial local refresh path without recent-repo side effects', async () => {
    const calls = installGbl()

    await useReposStore.getState().hydrateSession([REPO_A, REPO_B], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_B)
    expect(useReposStore.getState().sessionReady).toBe(true)
    expect(calls.recent).toEqual([])
    expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    expect(calls.status).toEqual([REPO_A, REPO_B])
  })

  test('hydrateSession keeps a user-selected active repo when boot probing settles later', async () => {
    installGbl()
    await useReposStore.getState().openRepo(REPO_A)

    await useReposStore.getState().hydrateSession([REPO_B], REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
  })

  test('initial refresh results from a closed repo instance do not overwrite a reopened repo', async () => {
    const snapshotResolvers: Array<(value: { branches: BranchInfo[]; current: string }) => void> = []
    installGbl({
      snapshot: () =>
        new Promise<{ branches: BranchInfo[]; current: string }>((resolve) => {
          snapshotResolvers.push(resolve)
        }),
    })

    await useReposStore.getState().openRepo(REPO_A)
    const firstToken = useReposStore.getState().repos[REPO_A]?.instanceToken
    useReposStore.getState().closeRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_A)
    const secondToken = useReposStore.getState().repos[REPO_A]?.instanceToken

    snapshotResolvers[1]?.({ branches: [branch('fresh')], current: 'fresh' })
    await Promise.resolve()
    await Promise.resolve()

    expect(secondToken).not.toBe(firstToken)
    expect(useReposStore.getState().repos[REPO_A]?.currentBranch).toBe('fresh')

    snapshotResolvers[0]?.({ branches: [branch('stale')], current: 'stale' })
    await Promise.resolve()
    await Promise.resolve()

    expect(useReposStore.getState().repos[REPO_A]?.currentBranch).toBe('fresh')
  })

  test('hydrateSession reports missing repos while restoring valid repos', async () => {
    installGbl()

    await useReposStore.getState().hydrateSession([REPO_A, '/missing'], '/missing')

    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(useReposStore.getState().missingFromSession).toEqual([{ path: '/missing', reason: 'missing' }])
  })
})
