// @vitest-environment jsdom

import { act, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceNavigationControls } from '#/web/components/WorkspaceNavigationControls.tsx'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import type { AppNavigationActions } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/navigation-controls-repo')

beforeEach(() => {
  resetWorkspacesStore()
})

describe('WorkspaceNavigationControls', () => {
  test('uses only the zen control as the reveal surface', () => {
    const onZenRevealTriggerEnter = vi.fn()
    const { container } = renderControls({ zenRevealTriggerEnabled: true, onZenRevealTriggerEnter })

    const controls = workspaceNavigationControls(container)
    expect(controls?.hasAttribute('data-zen-reveal-surface')).toBe(false)
    expect(controls?.className).toContain('goblin-workspace-navigation-controls')
    expect(zenRevealSurface(container)?.contains(zenButton())).toBe(true)

    act(() => {
      backButton().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(onZenRevealTriggerEnter).not.toHaveBeenCalled()

    act(() => {
      zenButton().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(onZenRevealTriggerEnter).toHaveBeenCalledTimes(1)
  })

  test('disables history buttons at stack boundaries and enables them when history is present', () => {
    const { container } = renderControls()

    expect(backButton().disabled).toBe(true)
    expect(forwardButton().disabled).toBe(true)

    act(() => {
      useWorkspacesStore.getState().recordWorkspaceNavigation({ workspaceId: REPO_ID, route: { kind: 'dashboard' } })
      useWorkspacesStore
        .getState()
        .recordWorkspaceNavigation({ workspaceId: REPO_ID, route: { kind: 'newWorktree', returnTo: null } })
    })

    expect(workspaceNavigationControls(container)?.className).toContain('goblin-workspace-navigation-controls')
    expect(backButton().disabled).toBe(false)
    expect(forwardButton().disabled).toBe(true)

    act(() => {
      const store = useWorkspacesStore.getState()
      const traversal = store.peekWorkspaceNavigation(REPO_ID, 'back')
      if (traversal) store.commitWorkspaceNavigation(traversal)
    })

    expect(backButton().disabled).toBe(true)
    expect(forwardButton().disabled).toBe(false)
  })

  test('routes back and forward clicks through app navigation', async () => {
    const user = userEvent.setup()
    const goBack = vi.fn()
    const goForward = vi.fn()
    renderControls({ navigation: navigationWith({ goBack, goForward }) })

    act(() => {
      useWorkspacesStore.getState().recordWorkspaceNavigation({ workspaceId: REPO_ID, route: { kind: 'dashboard' } })
      useWorkspacesStore
        .getState()
        .recordWorkspaceNavigation({ workspaceId: REPO_ID, route: { kind: 'newWorktree', returnTo: null } })
    })

    await user.click(backButton())
    expect(goBack).toHaveBeenCalledWith(REPO_ID)

    act(() => {
      const store = useWorkspacesStore.getState()
      const traversal = store.peekWorkspaceNavigation(REPO_ID, 'back')
      if (traversal) store.commitWorkspaceNavigation(traversal)
    })

    await user.click(forwardButton())
    expect(goForward).toHaveBeenCalledWith(REPO_ID)
  })
})

function renderControls({
  workspaceId = REPO_ID,
  zenRevealTriggerEnabled = false,
  onZenRevealTriggerEnter,
  navigation = navigationWith(),
}: {
  workspaceId?: WorkspaceId
  zenRevealTriggerEnabled?: boolean
  onZenRevealTriggerEnter?: () => void
  navigation?: AppNavigationActions
} = {}) {
  return renderInJsdom(
    <AppNavigationProvider value={navigation}>
      <WorkspaceNavigationControls
        workspaceId={workspaceId}
        zenRevealTriggerEnabled={zenRevealTriggerEnabled}
        onZenRevealTriggerEnter={onZenRevealTriggerEnter}
      />
    </AppNavigationProvider>,
  )
}

function navigationWith(
  overrides: Partial<Pick<AppNavigationActions, 'goBack' | 'goForward'>> = {},
): AppNavigationActions {
  return appNavigationActionsForTest({
    goBack: () => {},
    goForward: () => {},
    ...overrides,
  })
}

function workspaceNavigationControls(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-workspace-navigation-controls')
}

function zenRevealSurface(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-zen-reveal-surface]')
}

function zenButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'workspace.zen-mode-toggle-label' })
}

function backButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'workspace.navigation-back' })
}

function forwardButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'workspace.navigation-forward' })
}
