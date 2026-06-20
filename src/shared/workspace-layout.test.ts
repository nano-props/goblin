import { describe, expect, test } from 'vitest'
import {
  DEFAULT_WORKSPACE_FOCUSED,
  DEFAULT_WORKSPACE_PANE_SIZES,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'

describe('normalizeWorkspaceSessionLayoutState', () => {
  test('preserves Focus Mode and workspace pane sizes', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspaceFocused: false,
        workspacePaneSizes: { 'left-right': 45 },
      }),
    ).toEqual({
      workspaceFocused: false,
      workspacePaneSizes: { 'left-right': 45 },
    })
  })

  test('falls back to defaults for invalid input', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspaceFocused: 'bad',
        workspacePaneSizes: { 'left-right': 'bad' },
      }),
    ).toEqual({
      workspaceFocused: DEFAULT_WORKSPACE_FOCUSED,
      workspacePaneSizes: DEFAULT_WORKSPACE_PANE_SIZES,
    })
  })
})
