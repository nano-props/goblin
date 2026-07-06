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
  test('keeps the whole control group available as the zen reveal surface', () => {
    const onRevealEnter = vi.fn()
    const { container } = renderControls({ revealEnabled: true, onRevealEnter })

    const controls = workspaceNavigationControls(container)
    expect(controls?.hasAttribute('data-zen-reveal-surface')).toBe(true)
    expect(controls?.className).toContain('goblin-workspace-navigation-controls')

    act(() => {
      controls?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(onRevealEnter).toHaveBeenCalledTimes(1)
  })

  test('disables history buttons at stack boundaries and enables them when history is present', () => {
    const { container } = renderControls()

    expect(backButton().disabled).toBe(true)
    expect(forwardButton().disabled).toBe(true)

    act(() => {
      useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'dashboard' } })
      useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'newWorktree', returnTo: null } })
    })

    expect(workspaceNavigationControls(container)?.className).toContain('goblin-workspace-navigation-controls')
    expect(backButton().disabled).toBe(false)
    expect(forwardButton().disabled).toBe(true)

    act(() => {
      useReposStore.getState().goBackInWorkspaceNavigation(REPO_ID)
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
      useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'newWorktree', returnTo: null } })
    })

    await user.click(backButton())
    expect(goBack).toHaveBeenCalledWith(REPO_ID)

    act(() => {
      useReposStore.getState().goBackInWorkspaceNavigation(REPO_ID)
    })

    await user.click(forwardButton())
    expect(goForward).toHaveBeenCalledWith(REPO_ID)
  })
})

function renderControls({
  repoId = REPO_ID,
  revealEnabled = false,
  onRevealEnter,
  navigation = navigationWith(),
}: {
  repoId?: string
  revealEnabled?: boolean
  onRevealEnter?: () => void
  navigation?: PrimaryWindowNavigationActions
} = {}) {
  return renderInJsdom(
    <PrimaryWindowNavigationProvider value={navigation}>
      <WorkspaceNavigationControls repoId={repoId} revealEnabled={revealEnabled} onRevealEnter={onRevealEnter} />
    </PrimaryWindowNavigationProvider>,
  )
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoBranchWorkspacePaneTab: () => {},
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  }
}

function workspaceNavigationControls(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-workspace-navigation-controls')
}

function backButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'workspace.navigation-back' })
}

function forwardButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'workspace.navigation-forward' })
}
