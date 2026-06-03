import { describe, expect, test } from 'vitest'
import { getRepoActivityControlView, isRepoPrimaryRefreshBusy } from '#/web/components/repo-activity/model.ts'
import { seedRepoState, resetReposStore } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const REPO_ID = '/tmp/repo-activity-control'

describe('RepoActivityControl', () => {
  test('keeps the primary refresh button idle during background fetches', () => {
    resetReposStore()
    seedRepoState({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.operations.fetch.phase = 'running'
      repo.operations.fetch.reason = 'fetch'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    const repo = useReposStore.getState().repos[REPO_ID]!
    expect(isRepoPrimaryRefreshBusy(repo)).toBe(false)
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: false })
  })

  test('keeps the primary refresh button idle during contextual status refreshes', () => {
    resetReposStore()
    seedRepoState({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.resources.status.phase = 'refreshing'
      repo.operations.status.phase = 'running'
      repo.operations.status.reason = 'status'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    const repo = useReposStore.getState().repos[REPO_ID]!
    expect(isRepoPrimaryRefreshBusy(repo)).toBe(false)
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: false })
  })

  test('marks the primary refresh button busy during manual refreshes', () => {
    resetReposStore()
    seedRepoState({ id: REPO_ID })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.operations.fetch.phase = 'running'
      repo.operations.fetch.reason = 'user-fetch'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    const repo = useReposStore.getState().repos[REPO_ID]!
    expect(isRepoPrimaryRefreshBusy(repo)).toBe(true)
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: true })
  })

  test('shows the primary refresh button for local-only repositories', () => {
    resetReposStore()
    seedRepoState({ id: REPO_ID, remote: { hasRemotes: false } })

    const repo = useReposStore.getState().repos[REPO_ID]!
    expect(
      getRepoActivityControlView({
        visibleActivity: null,
        completion: null,
        manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
      }),
    ).toMatchObject({ kind: 'refresh-button', manualSyncBusy: false })
  })
})
