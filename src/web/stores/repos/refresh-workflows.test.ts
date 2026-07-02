import { describe, expect, test, vi } from 'vitest'
import { runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'
import type { ReposSet } from '#/web/stores/repos/types.ts'
import { createBranchSnapshot, installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

describe('repo refresh workflows', () => {
  test('snapshot success backfills summary then visible selected repo workspace', async () => {
    const calls: string[] = []
    installGoblinTestBridge({})
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

    expect(calls).toEqual(['prs:/repo:feature/a,feature/b:summary:true:repo-instance-test-2', 'prs:/repo:feature/a:full:false:repo-instance-test-2'])
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
})
