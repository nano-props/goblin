// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '#/web/App.tsx'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
  useIsCompactUi: () => responsiveMocks.mode === 'compact',
}))

vi.mock('#/web/components/Topbar.tsx', () => ({
  Topbar: ({ children }: { children: React.ReactNode }) => <div data-testid="topbar">{children}</div>,
}))

vi.mock('#/web/components/RepoPickerHost.tsx', () => ({
  RepoPickerHost: () => <div data-testid="repo-picker" />,
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

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after }: { before: React.ReactNode; after: React.ReactNode }) => (
    <div data-testid="mock-split-pane">
      {before}
      {after}
    </div>
  ),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  responsiveMocks.mode = 'default'
  resetReposStore()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('App boot skeleton', () => {
  test('keeps the legacy topbar repo picker while no repository is open', () => {
    useReposStore.setState({ sessionReady: true })

    render(<App />)

    expect(container?.querySelector('[data-testid="topbar"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="repo-picker"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="repo-view"]')).toBeNull()
  })

  test('does not render the legacy topbar for an active repository shell', () => {
    seedRepoState({ id: '/tmp/repo' })

    render(<App />)

    expect(container?.querySelector('[data-testid="repo-view"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="topbar"]')).toBeNull()
  })

  test('uses a single-pane navigator skeleton in compact mode before session restore is ready', () => {
    responsiveMocks.mode = 'compact'

    render(<App />)

    expect(container?.querySelector('[data-testid="mock-split-pane"]')).toBeNull()
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container?.querySelector('[data-testid="branch-workspace-empty-skeleton"]')).toBeNull()
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(
      <LayoutOverlayActions.Provider
        value={{
          openRepoPathDialog: vi.fn(),
          openRemoteRepo: vi.fn(),
          openCloneRepo: vi.fn(),
          openCreateWorktree: vi.fn(),
        }}
      >
        {element}
      </LayoutOverlayActions.Provider>,
    )
  })
}
