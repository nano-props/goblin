import { describe, expect, test } from 'vitest'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('repoWorkspaceBehavior', () => {
  test('renders split behavior when neither compact nor Zen Mode is active', () => {
    expect(repoWorkspaceBehavior({ compact: false, zenMode: false })).toMatchObject({
      mode: 'split',
      singlePane: false,
      zenMode: false,
      branchNavigatorCollapsed: false,
    })
  })

  test('uses Branch Navigator as the single pane when large-screen Zen Mode has no active branch workspace', () => {
    expect(repoWorkspaceBehavior({ compact: false, zenMode: true })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      zenMode: true,
      branchNavigatorCollapsed: false,
    })
  })

  test('collapses Branch Navigator inside split layout when large-screen Zen Mode has an active branch workspace', () => {
    expect(
      repoWorkspaceBehavior({
        compact: false,
        zenMode: true,
        branchWorkspaceActive: true,
      }),
    ).toMatchObject({
      mode: 'split',
      singlePane: false,
      zenMode: true,
      branchNavigatorCollapsed: true,
    })
  })

  test('uses single-pane behavior in compact mode even when Zen Mode is off', () => {
    expect(repoWorkspaceBehavior({ compact: true, zenMode: false })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      zenMode: false,
      branchNavigatorCollapsed: false,
    })
  })

  test('hides Branch Navigator in compact mode once a branch workspace is active', () => {
    expect(
      repoWorkspaceBehavior({
        compact: true,
        zenMode: false,
        branchWorkspaceActive: true,
      }),
    ).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      branchNavigatorCollapsed: false,
    })
  })
})
