// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Topbar } from '#/web/components/Topbar.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'

vi.mock('#/web/components/repo-toolbar/RepoToolbarActions.tsx', () => ({
  RepoToolbarActions: () => null,
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => false,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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
  test('hides the Branch List toggle when no repository is active', () => {
    render(
      <Topbar repoId={null} onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    expect(branchListToggle()).toBeNull()
  })

  test('toggles Branch List visibility through detail focus mode', () => {
    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    const button = branchListToggle()
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-pressed')).toBe('false')

    act(() => {
      button?.click()
    })

    expect(useReposStore.getState().workspacePaneFocusMode).toBe(true)
    expect(branchListToggle()?.getAttribute('aria-pressed')).toBe('true')
    expect(branchListToggle()?.classList.contains('bg-accent')).toBe(false)
    expect(branchListToggle()?.classList.contains('shadow-xs')).toBe(false)

    act(() => {
      branchListToggle()?.click()
    })

    expect(useReposStore.getState().workspacePaneFocusMode).toBe(false)
    expect(branchListToggle()?.getAttribute('aria-pressed')).toBe('false')
  })

  test('uses the left pane icon for the Branch List toggle', () => {
    render(
      <Topbar repoId="/tmp/repo" onOpenSettings={() => {}}>
        <div />
      </Topbar>,
    )

    expect(branchListToggleIcon()?.classList.contains('lucide-panel-left')).toBe(true)
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function branchListToggle(): HTMLButtonElement | null {
  return container?.querySelector('button[aria-label="workspace.branch-list-toggle-label"]') ?? null
}

function branchListToggleIcon(): SVGElement | null {
  return branchListToggle()?.querySelector('svg') ?? null
}
