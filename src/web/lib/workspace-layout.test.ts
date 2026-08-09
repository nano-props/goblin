import { describe, expect, test } from 'vitest'
import { workspaceLayoutBehavior } from '#/web/lib/workspace-layout.ts'

describe('workspaceLayoutBehavior', () => {
  test('renders split behavior when neither compact nor Zen Mode is active', () => {
    expect(workspaceLayoutBehavior({ compact: false, zenMode: false })).toMatchObject({
      mode: 'split',
      singlePane: false,
      zenMode: false,
      sidebarCollapsed: false,
    })
  })

  test('uses the sidebar as the single pane when large-screen Zen Mode has no active workspace pane', () => {
    expect(workspaceLayoutBehavior({ compact: false, zenMode: true })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      zenMode: true,
      sidebarCollapsed: false,
    })
  })

  test('collapses the sidebar inside split layout when large-screen Zen Mode has an active workspace pane', () => {
    expect(
      workspaceLayoutBehavior({
        compact: false,
        zenMode: true,
        workspacePaneActive: true,
      }),
    ).toMatchObject({
      mode: 'split',
      singlePane: false,
      zenMode: true,
      sidebarCollapsed: true,
    })
  })

  test('uses single-pane behavior in compact mode even when Zen Mode is off', () => {
    expect(workspaceLayoutBehavior({ compact: true, zenMode: false })).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      zenMode: false,
      sidebarCollapsed: false,
    })
  })

  test('hides the sidebar in compact mode once a workspace pane is active', () => {
    expect(
      workspaceLayoutBehavior({
        compact: true,
        zenMode: false,
        workspacePaneActive: true,
      }),
    ).toMatchObject({
      mode: 'single-pane',
      singlePane: true,
      compact: true,
      sidebarCollapsed: false,
    })
  })
})
