import { describe, expect, test } from 'vitest'
import { DEFAULT_DETAIL_PANE_SIZES, normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'

describe('normalizeWorkspaceSessionLayoutState', () => {
  test('disables detail focus mode and collapse when the layout does not support them', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspaceLayout: 'left-right',
        detailCollapsed: true,
        detailFocusMode: true,
        detailPaneSizes: { 'top-bottom': 55, 'left-right': 45 },
      }),
    ).toEqual({
      workspaceLayout: 'left-right',
      detailCollapsed: false,
      detailFocusMode: false,
      detailPaneSizes: { 'top-bottom': 55, 'left-right': 45 },
    })
  })

  test('falls back to defaults for invalid input', () => {
    expect(
      normalizeWorkspaceSessionLayoutState({
        workspaceLayout: 'branches',
        detailCollapsed: 'yes',
        detailFocusMode: 'focus',
        detailPaneSizes: { 'top-bottom': 'bad' },
      }),
    ).toEqual({
      workspaceLayout: 'top-bottom',
      detailCollapsed: true,
      detailFocusMode: false,
      detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
    })
  })
})
