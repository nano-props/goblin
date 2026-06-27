import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PULL_REQUEST_UNKNOWN_RETRY_DELAY_MS } from '#/shared/pull-request-state.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { preferredWorkspacePaneViewByBranchRecordWith } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { PullRequestInfo } from '#/web/types.ts'
import {
  branch,
  pullRequest,
  pullRequestWithHealth,
  REPO_ID,
  resetRefreshTest,
  ipcHandlers,
  seedRepo,
} from '#/web/stores/repos/refresh-test-utils.ts'

beforeEach(resetRefreshTest)
afterEach(() => {
  vi.useRealTimers()
})

function selectBranchForTest(branch: string): void {
  useReposStore.setState((s) => ({
    repos: {
      ...s.repos,
      [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
        repo.ui.selectedBranch = branch
      }),
    },
  }))
}

describe('refreshPullRequests', () => {
  test('snapshot records local-only remote capability and clears stale pull requests', async () => {
    const stale = pullRequest(1)
    const token = seedRepo([branch('feature/a', stale)])
    useReposStore.setState((s) => ({
      repos: {
        ...s.repos,
        [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
          repo.remote.fetchFailed = true
          repo.remote.fetchError = 'previous failure'
        }),
      },
    }))
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/a')],
      current: 'feature/a',
      remote: {
        remotes: [],
        hasRemotes: false,
        hasBrowserRemote: false,
        remoteProviders: {},
        hasGitHubRemote: false,
      },
    })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.remote).toMatchObject({
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      remoteProviders: {},
      hasGitHubRemote: false,
      fetchFailed: false,
      fetchError: null,
    })
    expect(repo?.data.branches[0]?.pullRequest).toBeUndefined()
  })

  test('skips pull request refresh for local-only repositories', async () => {
    const token = seedRepo([branch('feature/a')])
    let callCount = 0
    useReposStore.setState((s) => ({
      repos: {
        ...s.repos,
        [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
          repo.remote.hasRemotes = false
          repo.remote.hasBrowserRemote = false
          repo.remote.hasGitHubRemote = false
        }),
      },
    }))
    ipcHandlers['repo.pullRequests'] = async () => {
      callCount += 1
      return []
    }

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    expect(callCount).toBe(0)
    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.phase).toBe('idle')
  })

  test('skips pull request refresh for browser-only remotes', async () => {
    const token = seedRepo([branch('feature/gitlab')])
    let callCount = 0
    useReposStore.setState((s) => ({
      repos: {
        ...s.repos,
        [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
          repo.remote.hasBrowserRemote = true
          repo.remote.hasGitHubRemote = false
        }),
      },
    }))
    ipcHandlers['repo.pullRequests'] = async () => {
      callCount += 1
      return []
    }

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/gitlab'], { token })

    expect(callCount).toBe(0)
    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.phase).toBe('idle')
  })

  test('snapshot refresh writes a durable repo cache entry without selecting a branch implicitly', async () => {
    const token = seedRepo([])
    ipcHandlers['repo.snapshot'] = async () => ({ branches: [branch('feature/a')], current: 'feature/a' })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const cached = useReposStore.getState().repoSnapshotCache[REPO_ID]
    expect(cached?.name).toBe('repo')
    expect(cached?.data.currentBranch).toBe('feature/a')
    expect(cached?.data.branches.map((b) => b.name)).toEqual(['feature/a'])
    expect(cached?.ui.selectedBranch).toBeNull()
  })

  test('attaches returned pull requests and clears stale entries for requested branches', async () => {
    const stale = pullRequest(1)
    const fresh = pullRequest(2)
    const token = seedRepo([branch('feature/a'), branch('feature/b', stale)])
    let mode: string | undefined
    ipcHandlers['repo.pullRequests'] = async ({ mode: receivedMode }: { mode?: string }) => {
      mode = receivedMode
      return [{ branch: 'feature/a', pullRequest: fresh }]
    }

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token })

    const branches = useReposStore.getState().repos[REPO_ID]?.data.branches
    expect(branches?.find((b) => b.name === 'feature/a')?.pullRequest).toEqual(fresh)
    expect(branches?.find((b) => b.name === 'feature/b')?.pullRequest).toBeUndefined()
    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.phase).toBe('idle')
    expect(mode).toBe('full')
  })

  test('does not attach reverse pull requests to the default branch', async () => {
    const reverse = pullRequest(1, { baseRefName: 'feature/a', headRefName: 'master' })
    const token = seedRepo([branch('master', reverse, { isDefault: true })])
    ipcHandlers['repo.pullRequests'] = async () => [{ branch: 'master', pullRequest: reverse }]

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['master'], { token })

    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[0]?.pullRequest).toBeUndefined()
  })

  test('clears returned pull requests that do not belong even when missing entries are preserved', async () => {
    const existing = pullRequest(1, { headRefName: 'master', baseRefName: 'master' })
    const reverse = pullRequest(2, { headRefName: 'master', baseRefName: 'feature/a' })
    const token = seedRepo([branch('master', existing, { isDefault: true })])
    ipcHandlers['repo.pullRequests'] = async () => [{ branch: 'master', pullRequest: reverse }]

    await useReposStore
      .getState()
      .refreshPullRequests(REPO_ID, ['master'], { token, mode: 'full', clearMissing: false })

    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[0]?.pullRequest).toBeUndefined()
  })

  test('keeps existing pull requests when summary lookup omits a requested branch', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    ipcHandlers['repo.pullRequests'] = async () => []

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token, mode: 'summary' })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.resources.pullRequests.phase).toBe('idle')
  })

  test('summary lookup can explicitly clear missing requested pull requests', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    ipcHandlers['repo.pullRequests'] = async () => []

    await useReposStore
      .getState()
      .refreshPullRequests(REPO_ID, ['feature/a'], { token, mode: 'summary', clearMissing: true })

    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[0]?.pullRequest).toBeUndefined()
    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.phase).toBe('idle')
  })

  test('summary lookup preserves existing full pull request health fields', async () => {
    const existing = pullRequestWithHealth(1)
    const summary = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    ipcHandlers['repo.pullRequests'] = async () => [{ branch: 'feature/a', pullRequest: summary }]

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
    ipcHandlers['repo.pullRequests'] = async () => []

    await useReposStore
      .getState()
      .refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token, mode: 'full', clearMissing: false })

    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[1]?.pullRequest).toEqual(existing)
  })

  test('does not let stale responses write into a reopened repo instance', async () => {
    let resolve!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    const token = seedRepo([branch('feature/a')], 1)
    ipcHandlers['repo.pullRequests'] = () =>
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
    expect(repo?.resources.pullRequests.phase).toBe('idle')
  })

  test('preserves existing pull requests when lookup is unavailable', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    ipcHandlers['repo.pullRequests'] = async () => null

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.resources.pullRequests.phase).toBe('idle')
    expect(repo?.resources.pullRequests.loadedAt).toBeNull()
    expect(repo?.resources.pullRequests.stale).toBe(true)
  })

  test('preserves existing pull request metadata while snapshot refresh rechecks', async () => {
    const existing = pullRequest(1)
    const token = seedRepo([branch('feature/a', existing)])
    let resolvePullRequests!: (value: null) => void
    ipcHandlers['repo.snapshot'] = async () => ({ branches: [branch('feature/a')], current: 'feature/a' })
    ipcHandlers['repo.pullRequests'] = () =>
      new Promise<null>((resolve) => {
        resolvePullRequests = resolve
      })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.pullRequest).toEqual(existing)
    expect(repo?.resources.pullRequests.phase).not.toBe('idle')

    resolvePullRequests(null)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test('clears preserved pull requests when snapshot recheck omits them', async () => {
    const staleSelected = pullRequest(1, { headRefName: 'feature/a', baseRefName: 'main' })
    const staleOther = pullRequest(2, { headRefName: 'feature/b', baseRefName: 'main' })
    const token = seedRepo([branch('feature/a', staleSelected), branch('feature/b', staleOther)])
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/a'), branch('feature/b')],
      current: 'feature/a',
    })
    ipcHandlers['repo.pullRequests'] = async () => []

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const branches = useReposStore.getState().repos[REPO_ID]?.data.branches
    expect(branches?.find((b) => b.name === 'feature/a')?.pullRequest).toBeUndefined()
    expect(branches?.find((b) => b.name === 'feature/b')?.pullRequest).toBeUndefined()
  })

  test('records pull request refresh failures as repo events', async () => {
    const token = seedRepo([branch('feature/a', pullRequest(1))])
    ipcHandlers['repo.pullRequests'] = async () => {
      throw new Error('github unavailable')
    }

    await useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    expect(useReposStore.getState().repos[REPO_ID]?.events).toEqual([
      expect.objectContaining({ kind: 'error', message: 'github unavailable' }),
    ])
    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests).toMatchObject({
      phase: 'idle',
      error: 'github unavailable',
      mode: null,
      stale: true,
    })
    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequestsByBranch['feature/a']).toMatchObject({
      phase: 'idle',
      error: 'github unavailable',
      mode: null,
      stale: true,
    })
  })

  test('snapshot refresh performs summary lookup then selected full lookup for visible detail', async () => {
    const token = seedRepo([branch('feature/a')])
    selectBranchForTest('feature/a')
    const calls: Array<{ branches?: string[]; mode?: string; loadingAtStart?: boolean }> = []
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/a'), branch('feature/b')],
      current: 'feature/a',
    })
    ipcHandlers['repo.pullRequests'] = async ({ branches, mode }: { branches?: string[]; mode?: string }) => {
      calls.push({
        branches,
        mode: mode,
        loadingAtStart: useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.phase !== 'idle',
      })
      return []
    }

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([
      { branches: ['feature/a', 'feature/b'], mode: 'summary', loadingAtStart: true },
      { branches: ['feature/a'], mode: 'full', loadingAtStart: true },
    ])
  })

  test('snapshot refresh retries visible full lookup when merge status is still pending', async () => {
    vi.useFakeTimers()
    const token = seedRepo([branch('feature/a')])
    selectBranchForTest('feature/a')
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    let fullCalls = 0
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/a')],
      current: 'feature/a',
    })
    ipcHandlers['repo.pullRequests'] = async ({ branches, mode }: { branches?: string[]; mode?: string }) => {
      calls.push({ branches, mode: mode })
      if (mode === 'summary') return [{ branch: 'feature/a', pullRequest: pullRequest(1) }]
      fullCalls += 1
      return [
        {
          branch: 'feature/a',
          pullRequest: pullRequest(1, { mergeable: fullCalls === 1 ? 'UNKNOWN' : 'MERGEABLE' }),
        },
      ]
    }

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_UNKNOWN_RETRY_DELAY_MS + 1)

    expect(calls).toEqual([
      { branches: ['feature/a'], mode: 'summary' },
      { branches: ['feature/a'], mode: 'full' },
      { branches: ['feature/a'], mode: 'full' },
    ])
    expect(useReposStore.getState().repos[REPO_ID]?.data.branches[0]?.pullRequest?.mergeable).toBe('MERGEABLE')
  })

  test('snapshot refresh skips selected full lookup when status detail is not visible', async () => {
    const token = seedRepo([branch('feature/a', undefined, { worktree: { path: '/tmp/feature-a-worktree' } })])
    useReposStore.setState((s) => ({
      repos: {
        ...s.repos,
        [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
          repo.ui.preferredWorkspacePaneViewByBranch = preferredWorkspacePaneViewByBranchRecordWith(
            repo.ui,
            repo.ui.selectedBranch ?? 'feature/a',
            'terminal',
          )
        }),
      },
    }))
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [
        branch('feature/a', undefined, { worktree: { path: '/tmp/feature-a-worktree' } }),
        branch('feature/b'),
      ],
      current: 'feature/a',
    })
    ipcHandlers['repo.pullRequests'] = async ({ branches, mode }: { branches?: string[]; mode?: string }) => {
      calls.push({ branches, mode: mode })
      return []
    }

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([{ branches: ['feature/a', 'feature/b'], mode: 'summary' }])
  })

  test('snapshot refresh stops pull request backfill after the first refresh error', async () => {
    const token = seedRepo([branch('feature/a')])
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/a'), branch('feature/b')],
      current: 'feature/a',
    })
    ipcHandlers['repo.pullRequests'] = async ({ branches, mode }: { branches?: string[]; mode?: string }) => {
      calls.push({ branches, mode: mode })
      throw new Error('GitHub CLI is not signed in to github.com')
    }

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([{ branches: ['feature/a', 'feature/b'], mode: 'summary' }])
    expect(useReposStore.getState().repos[REPO_ID]?.events).toEqual([
      expect.objectContaining({ kind: 'error', message: 'GitHub CLI is not signed in to github.com' }),
    ])
  })

  test('snapshot refresh unavailable pull request lookups do not enqueue repo error events', async () => {
    const token = seedRepo([branch('feature/a')])
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/a'), branch('feature/b')],
      current: 'feature/a',
    })
    ipcHandlers['repo.pullRequests'] = async () => null

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useReposStore.getState().repos[REPO_ID]?.events).toEqual([])
    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.error).toBeNull()
  })

  test('ignores stale pull request lookups for the same repo instance', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveFirst!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    let resolveSecond!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    let callCount = 0
    ipcHandlers['repo.pullRequests'] = () => {
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
    expect(repo?.resources.pullRequests.phase).toBe('idle')
  })

  test('settles branch resources that are only owned by a stale lookup', async () => {
    const token = seedRepo([branch('feature/a'), branch('feature/b')])
    let resolveFirst!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    let resolveSecond!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    let callCount = 0
    ipcHandlers['repo.pullRequests'] = () => {
      callCount += 1
      return new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((resolve) => {
        if (callCount === 1) resolveFirst = resolve
        else resolveSecond = resolve
      })
    }

    const first = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a', 'feature/b'], { token })
    const second = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    resolveSecond([])
    await second
    resolveFirst([])
    await first

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.resources.pullRequests.phase).toBe('idle')
    expect(repo?.resources.pullRequestsByBranch['feature/a']?.phase).toBe('idle')
    expect(repo?.resources.pullRequestsByBranch['feature/b']?.phase).toBe('idle')
  })

  test('does not recreate branch resources for branches removed before lookup completion', async () => {
    const token = seedRepo([branch('feature/a'), branch('feature/b')])
    let resolve!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    ipcHandlers['repo.pullRequests'] = () =>
      new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((r) => {
        resolve = r
      })

    const work = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/b'], { token })
    useReposStore.setState((s) => ({
      repos: {
        ...s.repos,
        [REPO_ID]: replaceRepo(s.repos[REPO_ID]!, (repo) => {
          repo.data.branches = repo.data.branches.filter((branch) => branch.name !== 'feature/b')
          delete repo.resources.pullRequestsByBranch['feature/b']
        }),
      },
    }))

    resolve([{ branch: 'feature/b', pullRequest: pullRequest(2) }])
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches.map((item) => item.name)).toEqual(['feature/a'])
    expect(repo?.resources.pullRequestsByBranch['feature/b']).toBeUndefined()
  })

  test('does not persist cache from a stale pull request lookup while a newer lookup is running', async () => {
    const token = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    let resolveSecond!: (value: { branch: string; pullRequest: PullRequestInfo }[]) => void
    ipcHandlers['repo.pullRequests'] = () => {
      callCount += 1
      return new Promise<{ branch: string; pullRequest: PullRequestInfo }[]>((resolve) => {
        if (callCount === 1) resolveFirst = resolve
        else resolveSecond = resolve
      })
    }

    const first = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })
    const second = useReposStore.getState().refreshPullRequests(REPO_ID, ['feature/a'], { token })

    resolveFirst([])
    await first

    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]).toBeUndefined()

    const fresh = pullRequest(2)
    resolveSecond([{ branch: 'feature/a', pullRequest: fresh }])
    await second

    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]?.data.branches[0]).toMatchObject({ name: 'feature/a' })
    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]?.data.branches[0]?.pullRequest).toBeUndefined()
  })
})
