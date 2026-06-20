import { describe, expect, test } from 'vitest'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('repoWorkspaceBehavior', () => {
  test('renders split behavior when neither compact nor Focus Mode is active', () => {
    expect(repoWorkspaceBehavior({ layout: 'left-right', compact: false, workspaceFocused: false })).toMatchObject({
      mode: 'split',
      singlePane: false,
      workspaceFocused: false,
      branchNavigatorActionsVisible: true,
    })
  })

  test('uses single-pane behavior when large-screen Focus Mode is active', () => {
    expect(repoWorkspaceBehavior({ layout: 'left-right', compact: false, workspaceFocused: true })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      workspaceFocused: true,
      branchNavigatorActionsVisible: true,
    })
  })

  test('uses single-pane behavior in compact mode even when Focus Mode is off', () => {
    expect(repoWorkspaceBehavior({ layout: 'left-right', compact: true, workspaceFocused: false })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      workspaceFocused: false,
      branchNavigatorActionsVisible: true,
    })
  })
})
