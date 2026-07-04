import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoShellForTest,
} from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData, setRepoStatusQueryData } from '#/web/repo-data-query.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

beforeEach(() => {
  resetReposStore()
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
    setRepoStatusQueryData('/repo', 'repo-instance-test-2', [])
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchName: 'feature/a',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    seedRepoShellForTest({ id: '/repo', instanceId: 'repo-instance-test-2', selectedBranch: 'feature/a' })
    useReposStore.setState({
      refreshPullRequests: (id, branches, options) => {
        calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}:${options?.repoInstanceId ?? ''}`)
        return Promise.resolve()
      },
    })

    runSnapshotSuccessWorkflow(useReposStore.setState, useReposStore.getState, {
      id: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchNames: ['feature/a', 'feature/b'],
      worktreePaths: [],
      isSnapshotCurrent: () => true,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([
      'prs:/repo:feature/a,feature/b:summary:repo-instance-test-2',
      'prs:/repo:feature/a:full:repo-instance-test-2',
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
    setRepoStatusQueryData('/repo', 'repo-instance-test-2', [])
    seedRepoShellForTest({ id: '/repo', instanceId: 'repo-instance-test-2', selectedBranch: 'feature/a' })
    useReposStore.setState({
      refreshPullRequests: (id, branches, options) => {
        calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}`)
        return Promise.resolve()
      },
    })

    runSnapshotSuccessWorkflow(useReposStore.setState, useReposStore.getState, {
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
    setRepoStatusQueryData('/repo', 'repo-instance-test-2', [])
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test-2',
      branchName: 'feature/query',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const calls: string[] = []
    seedRepoShellForTest({ id: '/repo', instanceId: 'repo-instance-test-2', selectedBranch: 'feature/query' })
    useReposStore.setState({
      refreshPullRequests: (id, branches, options) => {
        calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}`)
        return Promise.resolve()
      },
    })

    runSnapshotSuccessWorkflow(useReposStore.setState, useReposStore.getState, {
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
