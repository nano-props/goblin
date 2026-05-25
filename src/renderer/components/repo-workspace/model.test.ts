import { describe, expect, test } from 'vitest'
import { getRepoWorkspacePresentation } from '#/renderer/components/repo-workspace/model.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { startResource } from '#/renderer/stores/repos/resources.ts'
import { createBranch } from '#/renderer/stores/repos/test-utils.ts'

describe('getRepoWorkspacePresentation', () => {
  test('reports missing repos without initial loading', () => {
    expect(getRepoWorkspacePresentation(undefined)).toEqual({
      exists: false,
      initialLoading: false,
    })
  })

  test('shows initial loading only while the first snapshot has no branches yet', () => {
    const repo = emptyRepo('/tmp/gbl-workspace-loading', 'repo')
    startResource(repo.resources.snapshot)

    expect(getRepoWorkspacePresentation(repo)).toEqual({
      exists: true,
      initialLoading: true,
    })
  })

  test('keeps cached branch data visible during snapshot refreshes', () => {
    const repo = emptyRepo('/tmp/gbl-workspace-cached-loading', 'repo')
    repo.data.branches = [createBranch('main')]
    startResource(repo.resources.snapshot, { hasData: true })

    expect(getRepoWorkspacePresentation(repo)).toEqual({
      exists: true,
      initialLoading: false,
    })
  })
})
