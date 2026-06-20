import { describe, expect, test } from 'vitest'
import {
  DEFAULT_WORKSPACE_PANE_SIZES,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'

describe('normalizeWorkspaceSessionLayoutState', () => {
  test('preserves focus mode and disables workspace pane collapse in the single layout', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspacePaneFocusMode: true,
        workspacePaneSizes: { 'left-right': 45 },
      }),
    ).toEqual({
      workspacePaneFocusMode: true,
      workspacePaneSizes: { 'left-right': 45 },
    })
  })

  test('falls back to defaults for invalid input', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspacePaneFocusMode: 'focus',
        workspacePaneSizes: { 'left-right': 'bad' },
      }),
    ).toEqual({
      workspacePaneFocusMode: false,
      workspacePaneSizes: DEFAULT_WORKSPACE_PANE_SIZES,
    })
  })
})
