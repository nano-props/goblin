import { beforeEach, describe, expect, test } from 'bun:test'
import { useReposStore } from '#/renderer/stores/repos.ts'
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
        pullRequests: async () => [],
      },
    },
  })
})

describe('refreshPullRequests', () => {
  test('attaches returned pull requests and clears stale entries for requested branches', async () => {
    const stale = pullRequest(1)
    const fresh = pullRequest(2)
    const token = seedRepo([branch('feature/a'), branch('feature/b', stale)])
    window.gbl.pullRequests = async () => [{ branch: 'feature/a', pullRequest: fresh }]

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token })

    const branches = useReposStore.getState().repos[REPO_ID]?.branches
    expect(branches?.find((b) => b.name === 'feature/a')?.pullRequest).toEqual(fresh)
    expect(branches?.find((b) => b.name === 'feature/b')?.pullRequest).toBeUndefined()
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
})
