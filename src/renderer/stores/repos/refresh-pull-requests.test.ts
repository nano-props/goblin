import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { PullRequestInfo } from '#/renderer/types.ts'
import {
  branch,
  pullRequest,
  pullRequestWithHealth,
  REPO_ID,
  resetRefreshTest,
  rpcHandlers,
  seedRepo,
} from '#/renderer/stores/repos/refresh-test-utils.ts'

beforeEach(resetRefreshTest)

describe('refreshPullRequests', () => {
  test('snapshot refresh writes a durable repo cache entry', async () => {
    const token = seedRepo([])
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('feature/a')], current: 'feature/a' })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const cached = useReposStore.getState().repoCache[REPO_ID]
    expect(cached?.name).toBe('repo')
    expect(cached?.data.currentBranch).toBe('feature/a')
    expect(cached?.data.branches.map((b) => b.name)).toEqual(['feature/a'])
    expect(cached?.ui.selectedBranch).toBe('feature/a')
  })

  test('attaches returned pull requests and clears stale entries for requested branches', async () => {
    const stale = pullRequest(1)
    const fresh = pullRequest(2)
    const token = seedRepo([branch('feature/a'), branch('feature/b', stale)])
    let mode: string | undefined
    rpcHandlers['repo.pullRequests'] = async ({ options }: { options?: { mode?: string } }) => {
      mode = options?.mode
      return [{ branch: 'feature/a', pullRequest: fresh }]
    }

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token })

    const branches = useReposStore.getState().repos[REPO_ID]?.data.branches
    expect(branches?.find((b) => b.name === 'feature/a')?.pullRequest).toEqual(fresh)
    expect(branches?.find((b) => b.name === 'feature/b')?.pullRequest).toBeUndefined()
    expect(useReposStore.getState().repos[REPO_ID]?.async.pullRequestsLoading).toBe(false)
    expect(mode).toBe('full')
  })

  test('keeps existing pull requests when summary lookup omits a requested branch', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    rpcHandlers['repo.pullRequests'] = async () => []

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token, mode: 'summary' })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.async.pullRequestsLoading).toBe(false)
  })

  test('summary lookup preserves existing full pull request health fields', async () => {
    const existing = pullRequestWithHealth(1)
    const summary = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    rpcHandlers['repo.pullRequests'] = async () => [{ branch: 'feature/a', pullRequest: summary }]

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token, mode: 'summary' })

    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[0]?.pullRequest).toEqual({
      ...summary,
      checks: existing.checks,
      reviewDecision: existing.reviewDecision,
      mergeable: existing.mergeable,
    })
  })

  test('full backfill can avoid clearing omitted branches', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a'), branch('feature/b', existing)])
    rpcHandlers['repo.pullRequests'] = async () => []

    await useReposStore
      .getState()
      .refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token, mode: 'full', clearMissing: false })

    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[1]?.pullRequest).toEqual(existing)
  })

  test('silent lookup during a visible lookup does not clear the visible loading state', async () => {
    let resolveVisible!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    const token = seedRepo([branch('feature/a'), branch('feature/b')])
    let callCount = 0
    rpcHandlers['repo.pullRequests'] = () => {
      callCount += 1
      return new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((resolve) => {
        resolveVisible = resolve
      })
    }

    const visible = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })
    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/b'], { token, mode: 'full', silent: true })

    expect(callCount).toBe(1)
    expect(useReposStore.getState().repos[REPO_ID]?.async.pullRequestsLoading).toBe(true)

    resolveVisible([])
    await visible

    expect(useReposStore.getState().repos[REPO_ID]?.async.pullRequestsLoading).toBe(false)
  })

  test('does not let stale responses write into a reopened repo instance', async () => {
    let resolve!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    const token = seedRepo([branch('feature/a')], 1)
    rpcHandlers['repo.pullRequests'] = () =>
      new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((r) => {
        resolve = r
      })

    const work = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })
    seedRepo([branch('feature/a')], 2)
    resolve([{ branch: 'feature/a', pullRequest: pullRequest(3) }])
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.data.branches[0]?.pullRequest).toBeUndefined()
    expect(repo?.async.pullRequestsLoading).toBe(false)
  })

  test('preserves existing pull requests when lookup is unavailable', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    rpcHandlers['repo.pullRequests'] = async () => null

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.async.pullRequestsLoading).toBe(false)
  })

  test('preserves existing pull request metadata while snapshot refresh rechecks', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    let resolvePullRequests!: (value: null) => void
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('feature/a')], current: 'feature/a' })
    rpcHandlers['repo.pullRequests'] = () =>
      new Promise<null>((resolve) => {
        resolvePullRequests = resolve
      })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.async.pullRequestsLoading).toBe(true)

    resolvePullRequests(null)
    await Promise.resolve()
  })

  test('snapshot refresh performs summary lookup, selected full lookup, then silent full backfill', async () => {
    const token = seedRepo([branch('feature/a')])
    const calls: Array<{ branches?: string[]; mode?: string; loadingAtStart?: boolean }> = []
    rpcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/a'), branch('feature/b')],
      current: 'feature/a',
    })
    rpcHandlers['repo.pullRequests'] = async ({
      branches,
      options,
    }: {
      branches?: string[]
      options?: { mode?: string }
    }) => {
      calls.push({
        branches,
        mode: options?.mode,
        loadingAtStart: useReposStore.getState().repos[REPO_ID]?.async.pullRequestsLoading,
      })
      return []
    }

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([
      { branches: ['feature/a', 'feature/b'], mode: 'summary', loadingAtStart: true },
      { branches: ['feature/a'], mode: 'full', loadingAtStart: true },
      { branches: ['feature/a', 'feature/b'], mode: 'full', loadingAtStart: false },
    ])
  })

  test('ignores stale pull request lookups for the same repo instance', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveFirst!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    let resolveSecond!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    let callCount = 0
    rpcHandlers['repo.pullRequests'] = () => {
      callCount += 1
      return new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((resolve) => {
        if (callCount === 1) resolveFirst = resolve
        else resolveSecond = resolve
      })
    }

    const first = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })
    const second = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    const fresh = pullRequest(2)
    resolveSecond([{ branch: 'feature/a', pullRequest: fresh }])
    await second

    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[0]?.pullRequest).toEqual(fresh)

    resolveFirst([])
    await first

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.pullRequest).toEqual(fresh)
    expect(repo?.async.pullRequestsLoading).toBe(false)
  })
})
