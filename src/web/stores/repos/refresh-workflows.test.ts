import { describe, expect, test } from 'vitest'
import {
  runBranchViewModeChangedWorkflow,
  runDetailTabChangedWorkflow,
  runInitialRepoLoad,
  runSnapshotSuccessWorkflow,
  runSelectedBranchChangedWorkflow,
} from '#/web/stores/repos/refresh-workflows.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'
import type { ReposSet } from '#/web/stores/repos/types.ts'
import { createBranchSnapshot, installGoblinTestBridge } from '#/web/stores/repos/test-utils.ts'
function callsGet() {
  const calls: string[] = []
  const get: ReposGet = () =>
    ({
      refreshSnapshot: (id: string, options?: { token?: number }) => {
        calls.push(`snapshot:${id}:${options?.token ?? ''}`)
        return Promise.resolve()
      },
      refreshStatus: (id: string, options?: { token?: number }) => {
        calls.push(`status:${id}:${options?.token ?? ''}`)
        return Promise.resolve()
      },
      refreshPullRequests: (
        id: string,
        branches?: string[],
        options?: { token?: number; mode?: string; clearMissing?: boolean },
      ) => {
        calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}:${options?.token ?? ''}`)
        return Promise.resolve()
      },
    }) as ReturnType<ReposGet>
  return { calls, get }
}

describe('repo refresh workflows', () => {
  test('runs the initial repo load as snapshot plus eager status refresh', () => {
    const { calls, get } = callsGet()

    runInitialRepoLoad(get, { id: '/repo', token: 7 })

    expect(calls).toEqual(['snapshot:/repo:7', 'status:/repo:7'])
  })

  test('runs tab-specific refresh work', () => {
    const { calls, get } = callsGet()

    runDetailTabChangedWorkflow(get, { id: '/repo', token: 1, tab: 'status', selectedBranch: 'main' })
    runDetailTabChangedWorkflow(get, { id: '/repo', token: 1, tab: 'status', selectedBranch: null })
    runDetailTabChangedWorkflow(get, { id: '/repo', token: 1, tab: undefined, selectedBranch: 'main' })

    expect(calls).toEqual(['prs:/repo:main:full:1'])
  })

  test('runs branch selection refresh work for visible detail data', () => {
    const { calls, get } = callsGet()

    runSelectedBranchChangedWorkflow(get, { id: '/repo', token: 3, branch: 'feature/a', tab: 'status' })

    expect(calls).toEqual(['prs:/repo:feature/a:full:3'])
  })

  test('skips branch selection log refresh outside the commits tab', () => {
    const { calls, get } = callsGet()

    runSelectedBranchChangedWorkflow(get, { id: '/repo', token: 3, branch: 'feature/a', tab: 'status' })

    expect(calls).toEqual(['prs:/repo:feature/a:full:3'])
  })

  test('runs branch view mode refresh work only for changed visible resources', () => {
    const { calls, get } = callsGet()

    runBranchViewModeChangedWorkflow(get, {
      id: '/repo',
      token: 4,
      selectedForPullRequest: 'feature/a',
    })

    expect(calls).toEqual(['prs:/repo:feature/a:full:4'])
  })

  test('skips branch view refreshes for unchanged resources', () => {
    const { calls, get } = callsGet()

    runBranchViewModeChangedWorkflow(get, {
      id: '/repo',
      token: 4,
      selectedForPullRequest: null,
    })

    expect(calls).toEqual([])
  })

  test('snapshot success backfills summary then visible selected branch detail', async () => {
    const calls: string[] = []
    installGoblinTestBridge({})
    const get: ReposGet = () =>
      ({
        repos: {
          '/repo': {
            id: '/repo',
            name: 'repo',
            instanceToken: 2,
            data: {
              branches: [createBranchSnapshot('feature/a')],
              currentBranch: 'feature/a',
              status: [],
              statusLoaded: false,
              worktreesByPath: {},
            },
            ui: { selectedBranch: 'feature/a', branchViewMode: 'all', detailTab: 'status' },
            resources: { pullRequests: { error: null } },
          },
        },
        refreshPullRequests: (
          id: string,
          branches?: string[],
          options?: { token?: number; mode?: string; clearMissing?: boolean },
        ) => {
          calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}:${String(options?.clearMissing ?? false)}:${options?.token ?? ''}`)
          return Promise.resolve()
        },
      }) as unknown as ReturnType<ReposGet>
    const set = ((_: unknown) => {}) as ReposSet

    runSnapshotSuccessWorkflow(set, get, {
      id: '/repo',
      token: 2,
      branchNames: ['feature/a', 'feature/b'],
      worktreePaths: [],
      isSnapshotCurrent: () => true,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([
      'prs:/repo:feature/a,feature/b:summary:true:2',
      'prs:/repo:feature/a:full:false:2',
    ])
  })
})
