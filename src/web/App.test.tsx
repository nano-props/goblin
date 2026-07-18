// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '#/web/App.tsx'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
  useIsCompactUi: () => responsiveMocks.mode === 'compact',
}))

vi.mock('#/web/components/EmptyRepoView.tsx', () => ({
  EmptyRepoView: () => <div data-testid="empty-repo-view" />,
}))

vi.mock('#/web/components/RepoView.tsx', () => ({
  RepoView: () => <div data-testid="repo-view" />,
}))

vi.mock('#/web/components/SettingsPageScreen.tsx', () => ({
  SettingsPageScreen: () => <div data-testid="settings-page" />,
}))

vi.mock('#/web/components/ErrorBoundary.tsx', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

beforeEach(() => {
  responsiveMocks.mode = 'default'
  resetReposStore()
})

describe('App workspace membership skeleton', () => {
  test('renders the empty repo shell while no repository is open', () => {
    useReposStore.setState({ workspaceMembershipReady: true })

    const { container } = render(<App />)

    expect(container.querySelector('[data-testid="empty-repo-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-view"]')).toBeNull()
  })

  test('renders the current repository shell when a repository is open', () => {
    seedRepoShellForTest({ id: 'goblin+file:///tmp/repo' })

    const { container } = render(<App routeRepoView={{ kind: 'dashboard', repoId: 'goblin+file:///tmp/repo' }} />)

    expect(container.querySelector('[data-testid="repo-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-repo-view"]')).toBeNull()
  })

  test('uses a single-pane navigator skeleton in compact mode before workspace membership is ready', () => {
    responsiveMocks.mode = 'compact'

    const { container } = render(<App />)

    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).toBeNull()
  })
})

function render(element: React.ReactNode) {
  return renderInJsdom(
    <LayoutOverlayActions
      value={{
        openWorkspacePathDialog: vi.fn(),
        openRemoteWorkspace: vi.fn(),
        openCloneRepo: vi.fn(),
        openCreateWorktree: vi.fn(),
      }}
    >
      {element}
    </LayoutOverlayActions>,
  )
}
