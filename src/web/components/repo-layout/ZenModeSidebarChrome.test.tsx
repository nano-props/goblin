// @vitest-environment jsdom

import { userEvent } from '@testing-library/user-event'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ZenModeSidebarChrome } from '#/web/components/repo-layout/ZenModeSidebarChrome.tsx'

vi.mock('#/web/components/WorkspaceZenModeToggle.tsx', () => ({
  WorkspaceZenModeToggle: (props: ComponentProps<'button'>) => (
    <button type="button" {...props}>
      zen
    </button>
  ),
}))

vi.mock('#/web/components/repo-layout/RepoLayoutSidebar.tsx', async () => {
  const { useState } = await import('react')
  const { Popover, PopoverContent, PopoverTrigger } = await import('#/web/components/ui/popover.tsx')

  return {
    RepoLayoutSidebar: () => {
      const [open, setOpen] = useState(false)

      return (
        <div data-testid="mock-sidebar">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button type="button" data-testid="descendant-popover-trigger">
                Open descendant menu
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <div data-testid="descendant-popover-content">Descendant menu</div>
              <button type="button" onClick={() => setOpen(false)}>
                Close descendant menu
              </button>
            </PopoverContent>
          </Popover>
        </div>
      )
    },
  }
})

beforeEach(() => {
  const win = window as typeof window & {
    PointerEvent?: typeof PointerEvent
    requestAnimationFrame?: typeof requestAnimationFrame
    cancelAnimationFrame?: typeof cancelAnimationFrame
  }
  win.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent ??= win.PointerEvent
  win.requestAnimationFrame ??= (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
  win.cancelAnimationFrame ??= (id: number) => window.clearTimeout(id)
  globalThis.requestAnimationFrame ??= win.requestAnimationFrame
  globalThis.cancelAnimationFrame ??= win.cancelAnimationFrame
})

describe('ZenModeSidebarChrome', () => {
  test('keeps the reveal open while a descendant Popover is open', async () => {
    const user = userEvent.setup()
    const { container } = renderInJsdom(
      <ZenModeSidebarChrome
        repoId="/tmp/repo"
        zenModeToggleEnabled
        revealEnabled
        sidebarSize={36}
        onSidebarSizeChange={() => {}}
      />,
    )

    act(() => {
      zenModeSidebarHitArea(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    await user.click(screen.getByTestId('descendant-popover-trigger'))
    await waitFor(() => {
      expect(screen.queryByTestId('descendant-popover-content')).not.toBeNull()
    })

    act(() => {
      zenModeSidebarReveal(container)?.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      )
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 900, clientY: 24 }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    const closedFloatingSurface = document.createElement('div')
    closedFloatingSurface.setAttribute('data-floating-surface', '')
    closedFloatingSurface.setAttribute('data-state', 'closed')
    document.body.appendChild(closedFloatingSurface)
    const originalElementFromPoint = document.elementFromPoint
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => closedFloatingSurface,
    })

    try {
      await user.click(screen.getByRole('button', { name: 'Close descendant menu' }))
      await waitFor(() => {
        expect(screen.queryByTestId('descendant-popover-content')).toBeNull()
      })

      await waitFor(() => {
        expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
      })
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      })
      closedFloatingSurface.remove()
    }
  })
})

function zenModeSidebarHitArea(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-hit-area"]')
}

function zenModeSidebarReveal(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-reveal"]')
}
