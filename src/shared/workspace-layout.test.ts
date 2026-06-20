import { describe, expect, test } from 'vitest'
import {
  DEFAULT_BRANCH_LIST_PANE_VISIBLE,
  DEFAULT_WORKSPACE_PANE_SIZES,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'

describe('normalizeWorkspaceSessionLayoutState', () => {
  test('preserves Branch View visibility and workspace pane sizes', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        branchListPaneVisible: false,
        workspacePaneSizes: { 'left-right': 45 },
      }),
    ).toEqual({
      branchListPaneVisible: false,
      workspacePaneSizes: { 'left-right': 45 },
    })
  })

  test('falls back to defaults for invalid input', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        branchListPaneVisible: 'bad',
        workspacePaneSizes: { 'left-right': 'bad' },
      }),
    ).toEqual({
      branchListPaneVisible: DEFAULT_BRANCH_LIST_PANE_VISIBLE,
      workspacePaneSizes: DEFAULT_WORKSPACE_PANE_SIZES,
    })
  })
})
