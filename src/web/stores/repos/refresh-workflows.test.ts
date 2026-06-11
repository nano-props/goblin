import { describe, expect, test, vi } from 'vitest'
import { runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'
import type { ReposSet } from '#/web/stores/repos/types.ts'
import { createBranchSnapshot, installGoblinTestBridge } from '#/web/stores/repos/test-utils.ts'

describe('repo refresh workflows', () => {
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

  test('snapshot success does not block pull request backfill on terminal prune completion', async () => {
    let resolvePrune!: () => void
    installGoblinTestBridge({
      'terminal.prune': async () => {
        await new Promise<void>((resolve) => {
          resolvePrune = resolve
        })
        return { pruned: 0, remaining: 0 }
      },
    })
    const calls: string[] = []
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
          calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}`)
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
    await vi.waitFor(() => {
      expect(calls).toEqual([
        'prs:/repo:feature/a,feature/b:summary',
        'prs:/repo:feature/a:full',
      ])
    })

    resolvePrune()
  })
})
