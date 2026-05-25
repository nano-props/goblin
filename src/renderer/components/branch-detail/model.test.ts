import { describe, expect, test } from 'vitest'
import {
  getSelectedBranchDetail,
  getSelectedBranchDetailPresentation,
} from '#/renderer/components/branch-detail/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { finishResourceError, startResource } from '#/renderer/stores/repos/resources.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'

describe('getSelectedBranchDetailPresentation', () => {
  test('returns empty selected detail when no branch is selected', () => {
    const repo = emptyRepo('/tmp/gbl-detail-presentation-empty', 'repo')
    repo.data.branches = [createBranch('main')]
    repo.ui.selectedBranch = null

    expect(getSelectedBranchDetail(repo)).toEqual({
      branch: null,
      branchLog: undefined,
      selectedStatus: [],
      statusCount: 0,
    })
  })

  test('returns empty selected detail when the selected branch no longer exists', () => {
    const repo = emptyRepo('/tmp/gbl-detail-presentation-missing', 'repo')
    repo.data.branches = [createBranch('main')]
    repo.ui.selectedBranch = 'feature/missing'

    expect(getSelectedBranchDetailPresentation(repo).branch).toBeNull()
  })

  test('derives log loading from resource state instead of log data', () => {
    const repo = emptyRepo('/tmp/gbl-detail-presentation-log', 'repo')
    repo.data.branches = [createBranch('main')]
    repo.ui.selectedBranch = 'main'
    repo.data.logsByBranch.main = { entries: [], selectedHash: null, hasMore: false }
    repo.resources.logsByBranch.main = { phase: 'loading', loadedAt: null, error: null, stale: false }

    const detail = getSelectedBranchDetailPresentation(repo)

    expect(detail.loading.log).toBe(true)
    expect(detail.loading.logInitial).toBe(true)
    expect(detail.loading.logAppend).toBe(false)
    expect(detail.loading.commits).toBe(true)
  })

  test('distinguishes append log loading from initial log loading', () => {
    const repo = emptyRepo('/tmp/gbl-detail-presentation-log-append', 'repo')
    repo.data.branches = [createBranch('main')]
    repo.ui.selectedBranch = 'main'
    repo.data.logsByBranch.main = {
      entries: [{ hash: 'a', shortHash: 'a', message: 'a', author: 'a', date: '2026-01-01' }],
      selectedHash: 'a',
      hasMore: true,
    }
    repo.resources.logsByBranch.main = { phase: 'refreshing', loadedAt: Date.now(), error: null, stale: false }

    const detail = getSelectedBranchDetailPresentation(repo)

    expect(detail.loading.logInitial).toBe(false)
    expect(detail.loading.logAppend).toBe(true)
  })

  test('surfaces status loading and errors from status resource state', () => {
    const repo = emptyRepo('/tmp/gbl-detail-presentation-status', 'repo')
    repo.data.branches = [createBranch('main', { worktreePath: '/tmp/worktree' })]
    repo.data.status = [
      {
        path: '/tmp/worktree',
        branch: 'main',
        isMain: true,
        entries: [{ x: 'M', y: ' ', path: 'README.md' }],
      },
    ]
    repo.ui.selectedBranch = 'main'
    finishResourceError(repo.resources.status, 'status failed')

    let detail = getSelectedBranchDetailPresentation(repo)
    expect(detail.statusCount).toBe(1)
    expect(detail.errors.status).toBe('status failed')
    expect(detail.loading.status).toBe(false)

    startResource(repo.resources.status, { hasData: true })
    detail = getSelectedBranchDetailPresentation(repo)
    expect(detail.loading.status).toBe(true)
    expect(detail.loading.pullRequests).toBe(false)
  })
})
