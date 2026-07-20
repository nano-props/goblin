import { describe, expect, test } from 'vitest'
import { selectedBranchForBranchSet } from '#/web/stores/workspaces/branch-view-mode.ts'
import { createRepoBranch } from '#/web/test-utils/bridge.ts'

describe('selectedBranchForBranchSet', () => {
  test('preserves no selection instead of selecting the current branch implicitly', () => {
    expect(
      selectedBranchForBranchSet({
        branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
        currentBranch: 'main',
        selectedBranch: null,
        viewMode: 'all',
      }),
    ).toBeNull()
  })

  test('falls back when an existing selection is no longer visible', () => {
    expect(
      selectedBranchForBranchSet({
        branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
        currentBranch: 'main',
        selectedBranch: 'missing',
        viewMode: 'all',
      }),
    ).toBe('main')
  })
})
