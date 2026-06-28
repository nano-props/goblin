// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { WorkspaceZenModeToggle } from '#/web/components/WorkspaceZenModeToggle.tsx'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

beforeEach(() => {
  resetReposStore()
})

describe('WorkspaceZenModeToggle', () => {
  test('keeps the same button node when zen mode changes', () => {
    const { container } = renderInJsdom(<WorkspaceZenModeToggle />)

    const button = zenModeToggle(container)
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-pressed')).toBe('false')

    act(() => {
      useReposStore.getState().setZenMode(true)
    })

    expect(zenModeToggle(container)).toBe(button)
    expect(zenModeToggle(container)?.getAttribute('aria-pressed')).toBe('true')
  })

  test('toggles zen mode when clicked', () => {
    const { container } = renderInJsdom(<WorkspaceZenModeToggle />)

    expect(useReposStore.getState().zenMode).toBe(false)

    act(() => {
      zenModeToggle(container)?.click()
    })

    expect(useReposStore.getState().zenMode).toBe(true)
    expect(zenModeToggle(container)?.getAttribute('aria-pressed')).toBe('true')
  })

  test('can own the title-bar-chrome interactive surface without changing visual size', () => {
    const { container } = renderInJsdom(
      <WorkspaceZenModeToggle
        data-interactive
        data-title-bar-chrome-region="interactive"
        className="pointer-events-auto"
      />,
    )

    expect(zenModeToggle(container)?.dataset.titleBarChromeRegion).toBe('interactive')
    expect(zenModeToggle(container)?.hasAttribute('data-interactive')).toBe(true)
    expect(zenModeToggle(container)?.dataset.size).toBe('icon-lg')
    expect(zenModeToggle(container)?.className).toContain('pointer-events-auto')
    expect(zenModeToggle(container)?.className).toContain('size-8')
    expect(zenModeToggle(container)?.className).not.toContain('size-10')
  })
})

function zenModeToggle(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label="workspace.zen-mode-toggle-label"]') ?? null
}
