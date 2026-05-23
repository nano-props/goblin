import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { branch, REPO_ID, resetRefreshTest, rpcHandlers, seedRepo } from '#/renderer/stores/repos/refresh-test-utils.ts'

beforeEach(resetRefreshTest)

describe('remote fetch timestamps', () => {
  test('manual sync records the remote fetch settled time', async () => {
    const token = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.async.lastFetchSettledAt).toBeGreaterThanOrEqual(before)
  })

  test('manual sync ignores stale fetch results after repo reopen', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const token = seedRepo([branch('feature/a')], 1)
    rpcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })

    const work = useReposStore.getState().syncAndRefresh(REPO_ID, { token })
    seedRepo([branch('feature/a')], 2)
    resolveFetch({ ok: true, message: 'ok' })
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.events).toEqual([])
    expect(repo?.async.lastFetchSettledAt).toBeNull()
  })

  test('background fetch records the remote fetch settled time', async () => {
    const token = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().backgroundFetch(REPO_ID)

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(token)
    expect(repo?.async.lastFetchSettledAt).toBeGreaterThanOrEqual(before)
  })

  test('does not mark a slow in-flight fetch as already settled', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveFetch!: (value: { ok: true; message: string }) => void
    rpcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })

    const work = useReposStore.getState().backgroundFetch(REPO_ID)

    expect(useReposStore.getState().repos[REPO_ID]?.async.lastFetchSettledAt).toBeNull()

    resolveFetch({ ok: true, message: 'ok' })
    await work

    expect(useReposStore.getState().repos[REPO_ID]?.instanceToken).toBe(token)
    expect(useReposStore.getState().repos[REPO_ID]?.async.lastFetchSettledAt).not.toBeNull()
  })

  test('coalesces concurrent background fetch requests for the same repo', async () => {
    seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFetch!: (value: { ok: true; message: string }) => void
    rpcHandlers['repo.fetch'] = () => {
      callCount += 1
      return new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })
    }

    const first = useReposStore.getState().backgroundFetch(REPO_ID)
    const second = useReposStore.getState().backgroundFetch(REPO_ID)

    expect(callCount).toBe(1)

    resolveFetch({ ok: true, message: 'ok' })
    await Promise.all([first, second])
  })
})
