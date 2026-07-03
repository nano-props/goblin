import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'
import type { ReposSet } from '#/web/stores/repos/types.ts'
import { createBranchSnapshot, installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'

beforeEach(() => {
  primaryWindowQueryClient.clear()
})

describe('repo refresh workflows', () => {
  test('snapshot success backfills summary then visible selected repo workspace', async () => {
    const calls: string[] = []
    installGoblinTestBridge({})
    setRepoSnapshotQueryData('/repo', 'repo-instance-test-2', {
      current: 'feature/a',
      branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchName: 'feature/a',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const get: ReposGet = () =>
      ({
        repos: {
          '/repo': {
            id: '/repo',
            name: 'repo',
            instanceId: 'repo-instance-test-2',
            data: {
              branches: [createBranchSnapshot('feature/a')],
              currentBranch: 'feature/a',
              status: [],
              statusLoaded: false,
              worktreesByPath: {},
            },
            ui: {
              selectedBranch: 'feature/a',
              branchViewMode: 'all',
              workspacePaneTabsByBranch: { 'feature/a': [workspacePaneStaticTabEntry('status')] },
              preferredWorkspacePaneTabByTarget: {},
            },
            dataLoads: { pullRequests: { error: null } },
          },
        },
        refreshPullRequests: (
          id: string,
          branches?: string[],
          options?: { repoInstanceId?: string; mode?: string; clearMissing?: boolean },
        ) => {
          calls.push(
            `prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}:${String(options?.clearMissing ?? false)}:${options?.repoInstanceId ?? ''}`,
          )
          return Promise.resolve()
        },
      }) as unknown as ReturnType<ReposGet>
    const set = ((_: unknown) => {}) as ReposSet

    runSnapshotSuccessWorkflow(set, get, {
      id: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchNames: ['feature/a', 'feature/b'],
      worktreePaths: [],
      isSnapshotCurrent: () => true,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([
      'prs:/repo:feature/a,feature/b:summary:true:repo-instance-test-2',
      'prs:/repo:feature/a:full:false:repo-instance-test-2',
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
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchName: 'feature/a',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const calls: string[] = []
    setRepoSnapshotQueryData('/repo', 'repo-instance-test-2', {
      current: 'feature/a',
      branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
    })
    const get: ReposGet = () =>
      ({
        repos: {
          '/repo': {
            id: '/repo',
            name: 'repo',
            instanceId: 'repo-instance-test-2',
            data: {
              branches: [createBranchSnapshot('feature/a')],
              currentBranch: 'feature/a',
              status: [],
              statusLoaded: false,
              worktreesByPath: {},
            },
            ui: {
              selectedBranch: 'feature/a',
              branchViewMode: 'all',
              workspacePaneTabsByBranch: { 'feature/a': [workspacePaneStaticTabEntry('status')] },
              preferredWorkspacePaneTabByTarget: {},
            },
            dataLoads: { pullRequests: { error: null } },
          },
        },
        refreshPullRequests: (
          id: string,
          branches?: string[],
          options?: { repoInstanceId?: string; mode?: string; clearMissing?: boolean },
        ) => {
          calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}`)
          return Promise.resolve()
        },
      }) as unknown as ReturnType<ReposGet>
    const set = ((_: unknown) => {}) as ReposSet

    runSnapshotSuccessWorkflow(set, get, {
      id: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchNames: ['feature/a', 'feature/b'],
      worktreePaths: [],
      isSnapshotCurrent: () => true,
    })
    await vi.waitFor(() => {
      expect(calls).toEqual(['prs:/repo:feature/a,feature/b:summary', 'prs:/repo:feature/a:full'])
    })

    resolvePrune()
  })

  test('visible selected workspace backfill resolves the selected branch from the React Query snapshot cache', async () => {
    installGoblinTestBridge({})
    setRepoSnapshotQueryData('/repo', 'repo-instance-test-2', {
      current: 'feature/query',
      branches: [createBranchSnapshot('feature/query')],
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchName: 'feature/query',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const calls: string[] = []
    const get: ReposGet = () =>
      ({
        repos: {
          '/repo': {
            id: '/repo',
            name: 'repo',
            instanceId: 'repo-instance-test-2',
            data: {
              branches: [],
              currentBranch: 'main',
              status: [],
              statusLoaded: false,
              worktreesByPath: {},
            },
            ui: {
              selectedBranch: 'feature/query',
              branchViewMode: 'all',
              workspacePaneTabsByBranch: {},
              preferredWorkspacePaneTabByTarget: {},
            },
            dataLoads: { pullRequests: { error: null } },
          },
        },
        refreshPullRequests: (
          id: string,
          branches?: string[],
          options?: { repoInstanceId?: string; mode?: string; clearMissing?: boolean },
        ) => {
          calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}`)
          return Promise.resolve()
        },
      }) as unknown as ReturnType<ReposGet>
    const set = ((_: unknown) => {}) as ReposSet

    runSnapshotSuccessWorkflow(set, get, {
      id: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchNames: ['feature/query'],
      worktreePaths: [],
      isSnapshotCurrent: () => true,
    })
    await vi.waitFor(() => {
      expect(calls).toEqual(['prs:/repo:feature/query:summary', 'prs:/repo:feature/query:full'])
    })
  })
})
