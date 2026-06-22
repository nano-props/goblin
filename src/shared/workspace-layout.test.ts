import { describe, expect, test } from 'vitest'
import {
  DEFAULT_WORKSPACE_FOCUSED,
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'

describe('normalizeWorkspaceSessionLayoutState', () => {
  test('preserves Focus Mode and workspace pane size', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspaceFocused: false,
        workspacePaneSize: 45,
      }),
    ).toEqual({
      workspaceFocused: false,
      workspacePaneSize: 45,
    })
  })

  test('falls back to defaults for invalid input', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspaceFocused: 'bad',
        workspacePaneSize: 'bad',
      }),
    ).toEqual({
      workspaceFocused: DEFAULT_WORKSPACE_FOCUSED,
      workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    })
  })
})
