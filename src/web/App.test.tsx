// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

vi.mock('#/web/components/EmptyWorkspaceView.tsx', () => ({
  EmptyWorkspaceView: () => <div data-testid="empty-workspace-view" />,
}))

vi.mock('#/web/components/Skeleton.tsx', () => ({
  WorkspaceLayoutSkeleton: () => <div data-testid="workspace-layout-skeleton" />,
}))

vi.mock('#/web/components/SettingsPageScreen.tsx', () => ({
  SettingsPageScreen: () => <div data-testid="settings-page-screen" />,
}))

vi.mock('#/web/components/WorkspaceView.tsx', () => ({
  WorkspaceView: () => <div data-testid="workspace-view" />,
}))

import { App } from '#/web/App.tsx'

describe('App', () => {
  beforeEach(() => {
    resetWorkspacesStore()
  })

  test('renders through setup JSX and updates from the workspace store', async () => {
    const view = renderInJsdom(<App />)

    expect(view.container.querySelector('[data-testid="workspace-layout-skeleton"]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="empty-workspace-view"]')).toBeNull()

    await flushTestUpdates(() => {
      workspacesStore.setState({ workspaceMembershipReady: true })
    })

    expect(view.container.querySelector('[data-testid="workspace-layout-skeleton"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="empty-workspace-view"]')).not.toBeNull()
  })

  test('merges caller classes with the component root class', async () => {
    const view = renderInJsdom(<App class="app-host" />)
    const root = view.container.firstElementChild

    expect(root?.classList.contains('app-host')).toBe(true)
    expect(root?.classList.contains('flex')).toBe(true)
  })
})
