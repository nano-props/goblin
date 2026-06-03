import { describe, expect, test } from 'vitest'
import { getRepoActivity, isRepoPrimaryRefreshBusy } from '#/web/components/repo-activity/model.ts'
import { seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-repo-activity-model'

describe('repo activity model', () => {
  test('does not surface summary pull request refreshes in the main repo activity control', () => {
    resetReposStore()
    seedRepoState({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.resources.pullRequests.phase = 'refreshing'
      repo.resources.pullRequests.mode = 'summary'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo).toBeDefined()
    expect(getRepoActivity(repo!)).toBeNull()
  })

  test('does not surface full pull request refreshes in the main repo activity control', () => {
    resetReposStore()
    seedRepoState({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.resources.pullRequests.phase = 'refreshing'
      repo.resources.pullRequests.mode = 'full'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo).toBeDefined()
    expect(getRepoActivity(repo!)).toBeNull()
  })

  test('only marks the primary refresh control busy for manual sync operations', () => {
    resetReposStore()
    seedRepoState({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.operations.fetch.phase = 'running'
      repo.operations.fetch.reason = 'fetch'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    expect(isRepoPrimaryRefreshBusy(useReposStore.getState().repos[REPO_ID]!)).toBe(false)

    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.operations.fetch.phase = 'running'
      repo.operations.fetch.reason = 'user-fetch'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    expect(isRepoPrimaryRefreshBusy(useReposStore.getState().repos[REPO_ID]!)).toBe(true)
  })
})
