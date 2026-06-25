import { describe, expect, test } from 'vitest'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('repoWorkspaceBehavior', () => {
  test('renders split behavior when neither compact nor Focus Mode is active', () => {
    expect(repoWorkspaceBehavior({ compact: false, workspaceFocused: false })).toMatchObject({
      mode: 'split',
      singlePane: false,
      workspaceFocused: false,
      branchNavigatorCollapsed: false,
      branchNavigatorVisible: true,
    })
  })

  test('uses Branch Navigator as the single pane when large-screen Focus Mode has no active branch workspace', () => {
    expect(repoWorkspaceBehavior({ compact: false, workspaceFocused: true })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      workspaceFocused: true,
      branchNavigatorCollapsed: false,
      branchNavigatorVisible: false,
    })
  })

  test('collapses Branch Navigator inside split layout when large-screen Focus Mode has an active branch workspace', () => {
    expect(
      repoWorkspaceBehavior({
        compact: false,
        workspaceFocused: true,
        branchWorkspaceActive: true,
      }),
    ).toMatchObject({
      mode: 'split',
      singlePane: false,
      workspaceFocused: true,
      branchNavigatorCollapsed: true,
      branchNavigatorVisible: false,
    })
  })

  test('uses single-pane behavior in compact mode even when Focus Mode is off', () => {
    expect(repoWorkspaceBehavior({ compact: true, workspaceFocused: false })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      workspaceFocused: false,
      branchNavigatorCollapsed: false,
      branchNavigatorVisible: true,
    })
  })

  test('hides Branch Navigator in compact mode once a branch workspace is active', () => {
    expect(
      repoWorkspaceBehavior({
        compact: true,
        workspaceFocused: false,
        branchWorkspaceActive: true,
      }),
    ).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      branchNavigatorCollapsed: false,
      branchNavigatorVisible: false,
    })
  })
})
