import { describe, expect, test } from 'vitest'
import { getRepoActivity, isRepoPrimaryRefreshBusy } from '#/web/components/repo-activity/model.ts'
import { seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import {
  markRepoOperationTargets,
  nextRepoOperationId,
  settleRepoOperationTargets,
} from '#/web/stores/repos/repo-operation-scheduler.ts'

const REPO_ID = '/tmp/gbl-repo-activity-model'

describe('repo activity model', () => {
  test('does not surface summary pull request refreshes in the main repo activity control', () => {
    resetReposStore()
    seedRepoShellForTest({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.dataLoads.pullRequests.phase = 'refreshing'
      repo.dataLoads.pullRequests.mode = 'summary'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo).toBeDefined()
    expect(getRepoActivity(repo!)).toBeNull()
  })

  test('does not surface full pull request refreshes in the main repo activity control', () => {
    resetReposStore()
    seedRepoShellForTest({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.dataLoads.pullRequests.phase = 'refreshing'
      repo.dataLoads.pullRequests.mode = 'full'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo).toBeDefined()
    expect(getRepoActivity(repo!)).toBeNull()
  })

  test('marks the primary refresh control busy while a manual refresh is active', () => {
    resetReposStore()
    seedRepoShellForTest({ id: REPO_ID })
    const opId = nextRepoOperationId(REPO_ID)
    markRepoOperationTargets(REPO_ID, opId, [{ key: 'manualRefresh', reason: 'manual-refresh' }], 'running')

    expect(isRepoPrimaryRefreshBusy(useReposStore.getState().repos[REPO_ID]!)).toBe(true)

    settleRepoOperationTargets(REPO_ID, opId, [{ key: 'manualRefresh', reason: 'manual-refresh' }], null)

    expect(isRepoPrimaryRefreshBusy(useReposStore.getState().repos[REPO_ID]!)).toBe(false)
  })
})
