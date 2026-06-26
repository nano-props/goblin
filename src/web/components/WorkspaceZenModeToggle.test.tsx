// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { WorkspaceZenModeToggle } from '#/web/components/WorkspaceZenModeToggle.tsx'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

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
})

describe('WorkspaceFocusToggle', () => {
  test('keeps the same button node when zen mode changes', () => {
    render(<WorkspaceFocusToggle />)

    const button = focusToggle()
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-pressed')).toBe('false')

    act(() => {
      useReposStore.getState().setZenMode(true)
    })

    expect(focusToggle()).toBe(button)
    expect(focusToggle()?.getAttribute('aria-pressed')).toBe('true')
  })

  test('toggles zen mode when clicked', () => {
    render(<WorkspaceFocusToggle />)

    expect(useReposStore.getState().zenMode).toBe(false)

    act(() => {
      focusToggle()?.click()
    })

    expect(useReposStore.getState().zenMode).toBe(true)
    expect(focusToggle()?.getAttribute('aria-pressed')).toBe('true')
  })

  test('can own the window-chrome interactive surface without changing visual size', () => {
    render(
      <WorkspaceFocusToggle data-interactive data-window-chrome-region="interactive" className="pointer-events-auto" />,
    )

    expect(focusToggle()?.dataset.windowChromeRegion).toBe('interactive')
    expect(focusToggle()?.hasAttribute('data-interactive')).toBe(true)
    expect(focusToggle()?.dataset.size).toBe('icon-lg')
    expect(focusToggle()?.className).toContain('pointer-events-auto')
    expect(focusToggle()?.className).toContain('size-8')
    expect(focusToggle()?.className).not.toContain('size-10')
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function focusToggle(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('button[aria-label="workspace.zen-mode-toggle-label"]') ?? null
}
