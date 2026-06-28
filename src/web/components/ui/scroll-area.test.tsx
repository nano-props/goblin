// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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

describe('ScrollArea', () => {
  test('marks scrollbars as no-drag window chrome regions', () => {
    render(
      <ScrollArea orientation="horizontal" type="always">
        <div className="w-[1000px]">wide content</div>
      </ScrollArea>,
    )

    const scrollBar = container?.querySelector('[data-title-bar-chrome-region="no-drag"]')

    expect(scrollBar).not.toBeNull()
    expect(scrollBar?.className).toContain('h-2')
    expect((container?.firstElementChild as HTMLElement | null)?.dataset.scrollbarMode).toBe('default')
  })

  test('marks compact scrollbar mode on the scroll area root', () => {
    render(
      <ScrollArea orientation="horizontal" scrollbarMode="compact" type="always">
        <div className="w-[1000px]">wide content</div>
      </ScrollArea>,
    )

    expect((container?.firstElementChild as HTMLElement | null)?.dataset.scrollbarMode).toBe('compact')
  })

  test('attaches viewportOnScroll to the scrollable viewport', () => {
    const onScroll = vi.fn()
    render(
      <ScrollArea viewportOnScroll={onScroll}>
        <div>content</div>
      </ScrollArea>,
    )

    const viewport = container?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
    expect(viewport).not.toBeNull()

    act(() => {
      viewport?.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(onScroll).toHaveBeenCalledTimes(1)
  })
})

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}
