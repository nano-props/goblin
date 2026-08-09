// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { beforeEach, describe, expect, test } from 'vitest'
import { WorkspaceZenModeToggle } from '#/web/components/WorkspaceZenModeToggle.tsx'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

beforeEach(() => {
  resetWorkspacesStore()
})

describe('WorkspaceZenModeToggle', () => {
  test('keeps the same button node when zen mode changes', async () => {
    const { container } = renderInJsdom(<WorkspaceZenModeToggle />)

    const button = zenModeToggle(container)
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-pressed')).toBe('false')

    await flushTestUpdates(() => {
      workspacesStore.getState().setZenMode(true)
    })

    expect(zenModeToggle(container)).toBe(button)
    expect(zenModeToggle(container)?.getAttribute('aria-pressed')).toBe('true')
  })

  test('toggles zen mode when clicked', async () => {
    const { container } = renderInJsdom(<WorkspaceZenModeToggle />)

    expect(workspacesStore.getState().zenMode).toBe(false)

    await flushTestUpdates(() => {
      zenModeToggle(container)?.click()
    })

    expect(workspacesStore.getState().zenMode).toBe(true)
    expect(zenModeToggle(container)?.getAttribute('aria-pressed')).toBe('true')
  })

  test('can own the title-bar-chrome interactive surface without changing visual size', async () => {
    const { container } = renderInJsdom(
      <WorkspaceZenModeToggle
        data-interactive
        data-title-bar-chrome-region="interactive"
        class="pointer-events-auto"
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
