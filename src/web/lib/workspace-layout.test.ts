import { describe, expect, test } from 'vitest'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('repoWorkspaceBehavior', () => {
  test('renders split behavior when neither compact nor Zen Mode is active', () => {
    expect(repoWorkspaceBehavior({ compact: false, zenMode: false })).toMatchObject({
      mode: 'split',
      singlePane: false,
      zenMode: false,
      sidebarCollapsed: false,
    })
  })

  test('uses the sidebar as the single pane when large-screen Zen Mode has no current repo workspace', () => {
    expect(repoWorkspaceBehavior({ compact: false, zenMode: true })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      zenMode: true,
      sidebarCollapsed: false,
    })
  })

  test('collapses the sidebar inside split layout when large-screen Zen Mode has a current repo workspace', () => {
    expect(
      repoWorkspaceBehavior({
        compact: false,
        zenMode: true,
        repoWorkspaceActive: true,
      }),
    ).toMatchObject({
      mode: 'split',
      singlePane: false,
      zenMode: true,
      sidebarCollapsed: true,
    })
  })

  test('uses single-pane behavior in compact mode even when Zen Mode is off', () => {
    expect(repoWorkspaceBehavior({ compact: true, zenMode: false })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      zenMode: false,
      sidebarCollapsed: false,
    })
  })

  test('hides the sidebar in compact mode once a repo workspace is active', () => {
    expect(
      repoWorkspaceBehavior({
        compact: true,
        zenMode: false,
        repoWorkspaceActive: true,
      }),
    ).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      sidebarCollapsed: false,
    })
  })
})
