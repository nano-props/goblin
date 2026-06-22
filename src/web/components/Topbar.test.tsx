// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Topbar } from '#/web/components/Topbar.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const responsiveMocks = vi.hoisted(() => ({
  compact: false,
}))

vi.mock('#/web/components/repo-toolbar/RepoToolbarActions.tsx', () => ({
  RepoToolbarActions: () => null,
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  responsiveMocks.compact = false
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
  vi.clearAllMocks()
})

describe('Topbar', () => {
  test('renders the settings button when no repository is active', () => {
    render(
      <Topbar repoId={null} onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    expect(settingsButton()).not.toBeNull()
  })

  test('renders a Focus Mode toggle before repo picker on large screens', () => {
    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div data-testid="repo-picker" />
      </Topbar>,
    )

    const toggle = focusModeToggle()
    const repoPicker = container?.querySelector('[data-testid="repo-picker"]')
    expect(toggle).not.toBeNull()
    expect(toggle?.nextElementSibling?.className).toContain('bg-separator')
    expect(toggle?.nextElementSibling?.nextElementSibling).toBe(repoPicker)
  })

  test('toggles large-screen Focus Mode with stable tooltip and button styling', () => {
    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    const initialClassName = focusModeToggle()?.className
    expect(useReposStore.getState().workspaceFocused).toBe(false)
    expect(focusModeToggle()?.getAttribute('aria-pressed')).toBe('false')
    expect(focusModeToggle()?.getAttribute('title')).toBe('workspace.focus-toggle-tooltip.enable')

    act(() => {
      focusModeToggle()?.click()
    })

    expect(useReposStore.getState().workspaceFocused).toBe(true)
    expect(focusModeToggle()?.getAttribute('aria-pressed')).toBe('true')
    expect(focusModeToggle()?.getAttribute('title')).toBe('workspace.focus-toggle-tooltip.enable')
    expect(focusModeToggle()?.className).toBe(initialClassName)
  })

  test('hides the Focus Mode toggle on compact screens', () => {
    responsiveMocks.compact = true

    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    expect(focusModeToggle()).toBeNull()
  })

  test('hides branch workspace back on large screens while focused on a selected branch', () => {
    seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      selectedBranch: 'feature/a',
    })
    useReposStore.getState().setWorkspaceFocused(true)

    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div data-testid="repo-picker" />
      </Topbar>,
    )

    const repoPicker = container?.querySelector('[data-testid="repo-picker"]')
    const toggle = focusModeToggle()
    expect(branchWorkspaceBackButton()).toBeNull()
    expect(toggle).not.toBeNull()
    expect(toggle?.nextElementSibling?.className).toContain('bg-separator')
    expect(toggle?.nextElementSibling?.nextElementSibling).toBe(repoPicker)
    expect(useReposStore.getState().workspaceFocused).toBe(true)
    expect(useReposStore.getState().repos['/tmp/repo']?.ui.selectedBranch).toBe('feature/a')
  })

  test('does not render branch workspace back in the topbar on compact screens', () => {
    responsiveMocks.compact = true
    seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      selectedBranch: 'feature/a',
    })

    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div data-testid="repo-picker" />
      </Topbar>,
    )

    const repoPicker = container?.querySelector('[data-testid="repo-picker"]')
    expect(branchWorkspaceBackButton()).toBeNull()
    expect(repoPicker).not.toBeNull()
    expect(useReposStore.getState().repos['/tmp/repo']?.ui.selectedBranch).toBe('feature/a')
  })

  test('hides branch workspace back on large screens outside Focus Mode', () => {
    seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      selectedBranch: 'feature/a',
    })

    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div data-testid="repo-picker" />
      </Topbar>,
    )

    expect(branchWorkspaceBackButton()).toBeNull()
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function focusModeToggle(): HTMLButtonElement | null {
  return container?.querySelector('button[aria-label="workspace.focus-toggle-label"]') ?? null
}

function settingsButton(): HTMLButtonElement | null {
  return container?.querySelector('button[aria-label="topbar.settings"]') ?? null
}

function branchWorkspaceBackButton(): HTMLButtonElement | null {
  return container?.querySelector('button[aria-label="workspace.back-to-branch-navigator"]') ?? null
}
