// @vitest-environment jsdom

import { act, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceNavigationControls } from '#/web/components/WorkspaceNavigationControls.tsx'
import { PrimaryWindowNavigationProvider } from '#/web/primary-window-navigation.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const REPO_ID = '/tmp/navigation-controls-repo'

beforeEach(() => {
  resetReposStore()
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
      useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'dashboard' } })
      useReposStore
        .getState()
        .recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'newWorktree', returnTo: null } })
    })

    expect(workspaceNavigationControls(container)?.className).toContain('goblin-workspace-navigation-controls')
    expect(backButton().disabled).toBe(false)
    expect(forwardButton().disabled).toBe(true)

    act(() => {
      const store = useReposStore.getState()
      const traversal = store.peekWorkspaceNavigation(REPO_ID, 'back')
      if (traversal) store.commitWorkspaceNavigation(traversal)
    })

    expect(backButton().disabled).toBe(true)
    expect(forwardButton().disabled).toBe(false)
  })

  test('routes back and forward clicks through primary window navigation', async () => {
    const user = userEvent.setup()
    const goBack = vi.fn()
    const goForward = vi.fn()
    renderControls({ navigation: navigationWith({ goBack, goForward }) })

    act(() => {
      useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'dashboard' } })
      useReposStore
        .getState()
        .recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'newWorktree', returnTo: null } })
    })

    await user.click(backButton())
    expect(goBack).toHaveBeenCalledWith(REPO_ID)

    act(() => {
      const store = useReposStore.getState()
      const traversal = store.peekWorkspaceNavigation(REPO_ID, 'back')
      if (traversal) store.commitWorkspaceNavigation(traversal)
    })

    await user.click(forwardButton())
    expect(goForward).toHaveBeenCalledWith(REPO_ID)
  })
})

function renderControls({
  repoId = REPO_ID,
  zenRevealTriggerEnabled = false,
  onZenRevealTriggerEnter,
  navigation = navigationWith(),
}: {
  repoId?: string
  zenRevealTriggerEnabled?: boolean
  onZenRevealTriggerEnter?: () => void
  navigation?: PrimaryWindowNavigationActions
} = {}) {
  return renderInJsdom(
    <PrimaryWindowNavigationProvider value={navigation}>
      <WorkspaceNavigationControls
        repoId={repoId}
        zenRevealTriggerEnabled={zenRevealTriggerEnabled}
        onZenRevealTriggerEnter={onZenRevealTriggerEnter}
      />
    </PrimaryWindowNavigationProvider>,
  )
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: async () => ({ ok: true }),
    cycleRepo: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    commitRepoBranchWorkspacePaneRoute: () => true,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
    currentRepoBranchWorkspacePaneRoute: overrides.currentRepoBranchWorkspacePaneRoute ?? (() => undefined),
  }
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
