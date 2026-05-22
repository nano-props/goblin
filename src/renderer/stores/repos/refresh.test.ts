import { beforeEach, describe, expect, test } from 'bun:test'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { BranchInfo, PullRequestInfo } from '#/renderer/types.ts'

const REPO_ID = '/tmp/gbl-test-repo'

function branch(name: string, pullRequest?: PullRequestInfo): BranchInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...(pullRequest ? { pullRequest } : {}),
  }
}

function pullRequest(number: number): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: 'open',
  }
}

function pullRequestWithHealth(number: number): PullRequestInfo {
  return {
    ...pullRequest(number),
    checks: { total: 1, passing: 1, failing: 0, pending: 0 },
    reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE',
  }
}

function seedRepo(branches: BranchInfo[], instanceToken = 1): number {
  const repo = {
    ...emptyRepo(REPO_ID, 'repo'),
    instanceToken,
    branches,
    loading: false,
    statusLoading: false,
  }
  useReposStore.setState({
    repos: { [REPO_ID]: repo },
    order: [REPO_ID],
    activeId: REPO_ID,
    sessionReady: true,
    missingFromSession: [],
    detailCollapsed: true,
  })
  return repo.instanceToken
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
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      gbl: {
        fetch: async () => ({ ok: true, message: 'ok' }),
        snapshot: async () => ({ branches: [], current: '' }),
        pullRequests: async () => [],
        status: async () => [],
      },
    },
  })
})

describe('remote fetch timestamps', () => {
  test('manual sync records the remote fetch settled time', async () => {
    const token = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.lastFetchSettledAt).toBeGreaterThanOrEqual(before)
  })

  test('manual sync ignores stale fetch results after repo reopen', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const token = seedRepo([branch('feature/a')], 1)
    window.gbl.fetch = () =>
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
    expect(repo?.lastFetchSettledAt).toBeNull()
  })

  test('background fetch records the remote fetch settled time', async () => {
    const token = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().backgroundFetch(REPO_ID)

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(token)
    expect(repo?.lastFetchSettledAt).toBeGreaterThanOrEqual(before)
  })

  test('does not mark a slow in-flight fetch as already settled', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveFetch!: (value: { ok: true; message: string }) => void
    window.gbl.fetch = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })

    const work = useReposStore.getState().backgroundFetch(REPO_ID)

    expect(useReposStore.getState().repos[REPO_ID]?.lastFetchSettledAt).toBeNull()

    resolveFetch({ ok: true, message: 'ok' })
    await work

    expect(useReposStore.getState().repos[REPO_ID]?.instanceToken).toBe(token)
    expect(useReposStore.getState().repos[REPO_ID]?.lastFetchSettledAt).not.toBeNull()
  })

  test('coalesces concurrent background fetch requests for the same repo', async () => {
    seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFetch!: (value: { ok: true; message: string }) => void
    window.gbl.fetch = () => {
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

describe('refreshPullRequests', () => {
  test('attaches returned pull requests and clears stale entries for requested branches', async () => {
    const stale = pullRequest(1)
    const fresh = pullRequest(2)
    const token = seedRepo([branch('feature/a'), branch('feature/b', stale)])
    let mode: string | undefined
    window.gbl.pullRequests = async (_id, _branches, options) => {
      mode = options?.mode
      return [{ branch: 'feature/a', pullRequest: fresh }]
    }

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token })

    const branches = useReposStore.getState().repos[REPO_ID]?.branches
    expect(branches?.find((b) => b.name === 'feature/a')?.pullRequest).toEqual(fresh)
    expect(branches?.find((b) => b.name === 'feature/b')?.pullRequest).toBeUndefined()
    expect(useReposStore.getState().repos[REPO_ID]?.pullRequestsLoading).toBe(false)
    expect(mode).toBe('full')
  })

  test('keeps existing pull requests when summary lookup omits a requested branch', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    window.gbl.pullRequests = async () => []

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token, mode: 'summary' })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.pullRequestsLoading).toBe(false)
  })

  test('summary lookup preserves existing full pull request health fields', async () => {
    const existing = pullRequestWithHealth(1)
    const summary = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    window.gbl.pullRequests = async () => [{ branch: 'feature/a', pullRequest: summary }]

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token, mode: 'summary' })

    expect(useReposStore.getState().repos[REPO_ID]?.branches[0]?.pullRequest).toEqual({
      ...summary,
      checks: existing.checks,
      reviewDecision: existing.reviewDecision,
      mergeable: existing.mergeable,
    })
  })

  test('full backfill can avoid clearing omitted branches', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a'), branch('feature/b', existing)])
    window.gbl.pullRequests = async () => []

    await useReposStore
      .getState()
      .refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token, mode: 'full', clearMissing: false })

    expect(useReposStore.getState().repos[REPO_ID]?.branches[1]?.pullRequest).toEqual(existing)
  })

  test('silent lookup during a visible lookup does not clear the visible loading state', async () => {
    let resolveVisible!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    const token = seedRepo([branch('feature/a'), branch('feature/b')])
    let callCount = 0
    window.gbl.pullRequests = () => {
      callCount += 1
      return new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((resolve) => {
        resolveVisible = resolve
      })
    }

    const visible = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })
    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/b'], { token, mode: 'full', silent: true })

    expect(callCount).toBe(1)
    expect(useReposStore.getState().repos[REPO_ID]?.pullRequestsLoading).toBe(true)

    resolveVisible([])
    await visible

    expect(useReposStore.getState().repos[REPO_ID]?.pullRequestsLoading).toBe(false)
  })

  test('does not let stale responses write into a reopened repo instance', async () => {
    let resolve!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    const token = seedRepo([branch('feature/a')], 1)
    window.gbl.pullRequests = () =>
      new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((r) => {
        resolve = r
      })

    const work = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })
    seedRepo([branch('feature/a')], 2)
    resolve([{ branch: 'feature/a', pullRequest: pullRequest(3) }])
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.branches[0]?.pullRequest).toBeUndefined()
    expect(repo?.pullRequestsLoading).toBe(false)
  })

  test('preserves existing pull requests when lookup is unavailable', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    window.gbl.pullRequests = async () => null

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.pullRequestsLoading).toBe(false)
  })

  test('preserves existing pull request metadata while snapshot refresh rechecks', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    let resolvePullRequests!: (value: null) => void
    window.gbl.snapshot = async () => ({ branches: [branch('feature/a')], current: 'feature/a' })
    window.gbl.pullRequests = () =>
      new Promise<null>((resolve) => {
        resolvePullRequests = resolve
      })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.pullRequestsLoading).toBe(true)

    resolvePullRequests(null)
    await Promise.resolve()
  })

  test('snapshot refresh performs summary lookup, selected full lookup, then silent full backfill', async () => {
    const token = seedRepo([branch('feature/a')])
    const calls: Array<{ branches?: string[]; mode?: string; loadingAtStart?: boolean }> = []
    window.gbl.snapshot = async () => ({ branches: [branch('feature/a'), branch('feature/b')], current: 'feature/a' })
    window.gbl.pullRequests = async (_id, branches, options) => {
      calls.push({
        branches,
        mode: options?.mode,
        loadingAtStart: useReposStore.getState().repos[REPO_ID]?.pullRequestsLoading,
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
    window.gbl.pullRequests = () => {
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

    expect(useReposStore.getState().repos[REPO_ID]?.branches[0]?.pullRequest).toEqual(fresh)

    resolveFirst([])
    await first

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.branches[0]?.pullRequest).toEqual(fresh)
    expect(repo?.pullRequestsLoading).toBe(false)
  })
})
