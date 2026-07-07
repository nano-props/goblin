import { describe, expect, test } from 'vitest'
import { getRepoActivityControlView, isRepoPrimaryRefreshBusy } from '#/web/components/repo-activity/model.ts'
import { seedRepoShellForTest, resetReposStore } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { markRepoOperationTargets, nextRepoOperationId } from '#/web/stores/repos/repo-operation-scheduler.ts'

const REPO_ID = '/tmp/repo-activity-control'

describe('RepoActivityControl', () => {
  test('marks the primary refresh button busy during any fetch', () => {
    resetReposStore()
    seedRepoShellForTest({ id: REPO_ID })
    markRepoOperationTargets(REPO_ID, nextRepoOperationId(REPO_ID), [{ key: 'fetch', reason: 'fetch' }], 'running')

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

  test('keeps the primary refresh button idle during contextual status refreshes', () => {
    resetReposStore()
    seedRepoShellForTest({ id: REPO_ID })
    markRepoOperationTargets(REPO_ID, nextRepoOperationId(REPO_ID), [{ key: 'visibleStatus', reason: 'visible-status' }], 'running')

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
    seedRepoShellForTest({ id: REPO_ID })
    markRepoOperationTargets(
      REPO_ID,
      nextRepoOperationId(REPO_ID),
      [{ key: 'manualRefresh', reason: 'manual-refresh' }],
      'running',
    )

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
    seedRepoShellForTest({ id: REPO_ID, remote: { hasRemotes: false } })

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
