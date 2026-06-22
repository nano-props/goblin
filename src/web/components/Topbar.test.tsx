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

// BranchListPopover pulls the store + navigation + portaled HoverCard
// (Radix HoverCard requires ResizeObserver and animation timing in
// jsdom that we don't want to fight here). The topbar test cares about
// which wrapper owns the trigger — Tip vs popover — so we expose a
// recognisable data attribute to assert on.
const popoverWrapper = vi.hoisted(() => ({ wrapperCount: 0 }))
vi.mock('#/web/components/branch-navigator/BranchListPopover.tsx', () => ({
  BranchListPopover: ({ children, repoId: _repoId }: { children: ReactNode; repoId: string }) => {
    popoverWrapper.wrapperCount += 1
    return <div data-testid="branch-list-popover-wrapper">{children}</div>
  },
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  responsiveMocks.compact = false
  popoverWrapper.wrapperCount = 0
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

  test('renders a Focus Mode toggle separated from the per-repo actions and flush with the settings button', () => {
    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div data-testid="repo-picker" />
      </Topbar>,
    )

    const toggle = focusModeToggle()
    const settings = settingsButton()
    const repoPicker = container?.querySelector('[data-testid="repo-picker"]')
    expect(toggle).not.toBeNull()
    expect(settings).not.toBeNull()
    expect(repoPicker).not.toBeNull()
    // Layout: [repo-picker] [RepoToolbarActions] [Separator] [focus-toggle] [settings]
    // The toggle sits immediately left of the settings button.
    expect(toggle?.nextElementSibling).toBe(settings)
    // A vertical Separator separates the per-repo actions cluster from
    // the focus-mode toggle (matches the convention enforced by
    // `ui-conventions.md`).
    expect(toggle?.previousElementSibling?.getAttribute('data-slot')).toBe('separator')
    expect(toggle?.previousElementSibling?.getAttribute('data-orientation')).toBe('vertical')
    // The repo picker is to the left of the toolbar cluster.
    expect(repoPicker?.nextElementSibling).not.toBe(toggle)
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
    // In focus mode the native title is dropped so the OS tooltip
    // doesn't race the hover card on touch / OS-default hover delays.
    expect(focusModeToggle()?.getAttribute('title')).toBeNull()
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
    const settings = settingsButton()
    expect(branchWorkspaceBackButton()).toBeNull()
    expect(toggle).not.toBeNull()
    // The focus toggle (wrapped in BranchListPopover mock) sits
    // immediately left of the settings button, with a vertical
    // Separator between it and the per-repo actions.
    const popoverWrapper = toggle?.closest('[data-testid="branch-list-popover-wrapper"]')
    expect(popoverWrapper).not.toBeNull()
    expect(popoverWrapper?.nextElementSibling).toBe(settings)
    expect(popoverWrapper?.previousElementSibling?.getAttribute('data-slot')).toBe('separator')
    expect(popoverWrapper?.previousElementSibling?.getAttribute('data-orientation')).toBe('vertical')
    expect(repoPicker).not.toBeNull()
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

  test('wraps the focus toggle in BranchListPopover while Focus Mode is on', () => {
    seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
    })
    useReposStore.getState().setWorkspaceFocused(true)

    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    const wrapper = container?.querySelector('[data-testid="branch-list-popover-wrapper"]')
    expect(wrapper).not.toBeNull()
    // The focus toggle button is still the popover trigger.
    expect(wrapper?.querySelector('button[aria-label="workspace.focus-toggle-label"]')).toBe(focusModeToggle())
    // Only the popover wrapper owns the trigger (no Tip wrapper also
    // renders the same button — would mean both wrappers are live).
    expect(popoverWrapper.wrapperCount).toBe(1)
  })

  test('keeps the text Tip on the focus toggle while Focus Mode is off', () => {
    seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('main')],
    })

    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    expect(useReposStore.getState().workspaceFocused).toBe(false)
    expect(container?.querySelector('[data-testid="branch-list-popover-wrapper"]')).toBeNull()
    expect(popoverWrapper.wrapperCount).toBe(0)
    // The tooltip wrapper is only built on hover via Radix; the
    // invariant we can assert is that the underlying button keeps the
    // existing title used by the text tooltip path.
    expect(focusModeToggle()?.getAttribute('title')).toBe('workspace.focus-toggle-tooltip.enable')
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
