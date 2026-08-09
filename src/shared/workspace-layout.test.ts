import { describe, expect, test } from 'vitest'
import {
  DEFAULT_ZEN_MODE,
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'

describe('normalizeWorkspaceSessionLayoutState', () => {
  test('preserves Zen Mode and workspace pane size', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        zenMode: false,
        workspacePaneSize: 45,
      }),
    ).toEqual({
      zenMode: false,
      workspacePaneSize: 45,
    })
  })

  test('falls back to defaults for invalid input', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        zenMode: 'bad',
        workspacePaneSize: 'bad',
      }),
    ).toEqual({
      zenMode: DEFAULT_ZEN_MODE,
      workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    })
  })
})
