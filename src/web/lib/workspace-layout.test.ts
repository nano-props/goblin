import { describe, expect, test } from 'vitest'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('repoWorkspaceBehavior', () => {
  test('renders split behavior when neither compact nor Focus Mode is active', () => {
    expect(repoWorkspaceBehavior({ layout: 'left-right', compact: false, workspaceFocused: false })).toMatchObject({
      mode: 'split',
      singlePane: false,
      workspaceFocused: false,
      branchNavigatorCollapsed: false,
      branchNavigatorActionsVisible: true,
    })
  })

  test('uses Branch Navigator as the single pane when large-screen Focus Mode has no active branch workspace', () => {
    expect(repoWorkspaceBehavior({ layout: 'left-right', compact: false, workspaceFocused: true })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      workspaceFocused: true,
      branchNavigatorCollapsed: false,
      branchNavigatorActionsVisible: true,
    })
  })

  test('collapses Branch Navigator inside split layout when large-screen Focus Mode has an active branch workspace', () => {
    expect(
      repoWorkspaceBehavior({
        layout: 'left-right',
        compact: false,
        workspaceFocused: true,
        branchWorkspaceActive: true,
      }),
    ).toMatchObject({
      mode: 'split',
      singlePane: false,
      workspaceFocused: true,
      branchNavigatorCollapsed: true,
      branchNavigatorActionsVisible: true,
    })
  })

  test('uses single-pane behavior in compact mode even when Focus Mode is off', () => {
    expect(repoWorkspaceBehavior({ layout: 'left-right', compact: true, workspaceFocused: false })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      workspaceFocused: false,
      branchNavigatorCollapsed: false,
      branchNavigatorActionsVisible: true,
    })
  })
})
