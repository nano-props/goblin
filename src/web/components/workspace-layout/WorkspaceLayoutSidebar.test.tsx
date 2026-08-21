// @vitest-environment jsdom

import { resetWorkspacesStore, seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import type { VNode } from 'vue'
import { fireEvent } from '@testing-library/vue'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { WorkspaceLayoutSidebar } from '#/web/components/workspace-layout/WorkspaceLayoutSidebar.tsx'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { appQueryClient } from '#/web/app/query-client.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { AppNavigationProvider } from '#/web/app/navigation/context.tsx'
import { navigation } from '#/web/test-utils/workspace-pane.tsx'

vi.mock('#/web/components/WorkspacePickerHost.tsx', () => ({
  WorkspacePickerHost: () => <button type="button" data-testid="workspace-picker-host" class="h-10 w-full shrink-0" />,
}))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/workspace-shell-sidebar-test')

function repoSnapshot() {
  const capability = workspacesStore.getState().workspaces[WORKSPACE_ID]?.capability
  if (capability?.kind !== 'git') throw new Error('Expected Git workspace fixture')
  return capability.git
}

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  seedRepoWithReadModelForTest({
    id: WORKSPACE_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
  })
})

afterEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  vi.restoreAllMocks()
})

describe('WorkspaceLayoutSidebar', () => {
  test('renders sidebar actions before the branch content without growing action rows', () => {
    const { container } = renderSidebar(
      <WorkspaceLayoutSidebar
        workspaceId={WORKSPACE_ID}
        git={repoSnapshot()}
        compact={false}
        navigatorContent={<div data-testid="navigator-content" />}
      />,
    )

    const workspacePicker = container.querySelector('[data-testid="workspace-picker-host"]')
    expect(workspacePicker).not.toBeNull()

    const createWorktree = container.querySelector('[data-testid="create-worktree-button"]')
    if (!(createWorktree instanceof HTMLButtonElement)) throw new Error('missing create worktree button')
    expect(createWorktree.className).toContain('shrink-0')
    expect(createWorktree.className).not.toContain('flex-1')

    const branchTitle = [...container.querySelectorAll('div')].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === 'tab.branches',
    )
    expect(branchTitle).not.toBeNull()
    expect(container.querySelector('[data-testid="navigator-content"]')).not.toBeNull()

    const settings = container.querySelector('button[aria-label="app-chrome.settings"]')
    expect(settings).not.toBeNull()
  })

  test('renders placeholder state when no repo is open', () => {
    const { container } = renderSidebar(<WorkspaceLayoutSidebar git={null} compact={false} />)

    expect(container.querySelector('[data-testid="workspace-picker-host"]')).not.toBeNull()

    const createWorktree = container.querySelector('[data-testid="create-worktree-button"]')
    expect(createWorktree).toBeNull()

    const branchTitle = [...container.querySelectorAll('div')].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === 'tab.branches',
    )
    expect(branchTitle).toBeUndefined()

    const settings = container.querySelector('button[aria-label="app-chrome.settings"]')
    expect(settings).not.toBeNull()
  })

  test('keeps the shared dashboard and navigator layout without Git-only controls when Git is unavailable', () => {
    const onOpenDashboard = vi.fn()
    const onSelectWorkspaceRoot = vi.fn()
    const { container } = renderSidebar(
      <WorkspaceLayoutSidebar
        workspaceId={WORKSPACE_ID}
        compact={false}
        git={null}
        onOpenDashboard={onOpenDashboard}
        onSelectWorkspaceRoot={onSelectWorkspaceRoot}
      />,
    )

    expect(container.querySelector('[data-testid="workspace-picker-host"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-button"]')).toBeNull()
    expect(container.querySelector('[data-testid="workspace-root-navigator"]')).not.toBeNull()
    expect(container.textContent).toContain('workspace.navigation-title')
    expect(container.textContent).not.toContain('tab.branches')
    expect(container.textContent).toContain('workspace.dashboard')
    expect(container.querySelector('button[aria-label="menu.view.refresh"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="app-chrome.settings"]')).not.toBeNull()
  })

  test('uses the workspace background throughout the sidebar in compact UI', () => {
    const { container } = renderSidebar(
      <WorkspaceLayoutSidebar workspaceId={WORKSPACE_ID} compact git={repoSnapshot()} navigatorContent={<div />} />,
    )

    const sidebar = container.querySelector('aside')
    expect(sidebar?.className).toContain('bg-background')
    expect(sidebar?.querySelectorAll('.bg-navigation')).toHaveLength(0)
  })

  test('keeps the navigation background in split UI', () => {
    const { container } = renderSidebar(
      <WorkspaceLayoutSidebar
        workspaceId={WORKSPACE_ID}
        compact={false}
        git={repoSnapshot()}
        navigatorContent={<div />}
      />,
    )

    expect(container.querySelector('aside')?.className).toContain('bg-navigation')
  })

  test('opens create-worktree from the row action', async () => {
    const onCreateWorktree = vi.fn()
    const { container } = renderSidebar(
      <WorkspaceLayoutSidebar
        workspaceId={WORKSPACE_ID}
        git={repoSnapshot()}
        compact={false}
        navigatorContent={<div />}
        onCreateWorktree={onCreateWorktree}
      />,
    )

    const createWorktree = container.querySelector('[data-testid="create-worktree-button"]')
    if (!(createWorktree instanceof HTMLButtonElement)) throw new Error('missing create worktree button')

    await fireEvent.click(createWorktree)

    expect(onCreateWorktree).toHaveBeenCalledTimes(1)
  })

  test('renders zen reveal top chrome as draggable without owning zen-toggle geometry', () => {
    const { container } = renderSidebar(
      <WorkspaceLayoutSidebar
        workspaceId={WORKSPACE_ID}
        git={repoSnapshot()}
        compact={false}
        navigatorContent={<div data-testid="navigator-content" />}
      />,
    )

    const sidebarTop = container.querySelector<HTMLElement>('[data-testid="workspace-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBe('drag')
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(sidebarTop?.hasAttribute('data-interactive')).toBe(false)
    expect(sidebarTop?.style.height).toBe(`${TITLE_BAR_HEIGHT_PX}px`)
  })

  test('can render the top chrome as neutral when the docked sidebar is collapsed', () => {
    const { container } = renderSidebar(
      <WorkspaceLayoutSidebar
        workspaceId={WORKSPACE_ID}
        git={repoSnapshot()}
        compact={false}
        chromeRegion="none"
        navigatorContent={<div data-testid="navigator-content" />}
      />,
    )

    const sidebarTop = container.querySelector<HTMLElement>('[data-testid="workspace-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(sidebarTop?.hasAttribute('data-interactive')).toBe(false)
    expect(sidebarTop?.style.height).toBe(`${TITLE_BAR_HEIGHT_PX}px`)
  })
})

function renderSidebar(element: VNode) {
  return renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <AppNavigationProvider value={navigation}>{element}</AppNavigationProvider>
    </VueQueryClientScope>,
  )
}
