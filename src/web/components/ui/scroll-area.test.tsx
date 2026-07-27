// @vitest-environment jsdom

import { fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'

describe('ScrollArea', () => {
  test('marks scrollbars as no-drag window chrome regions', () => {
    const { container } = renderInJsdom(
      <ScrollArea orientation="horizontal" type="always">
        <div className="w-[1000px]">wide content</div>
      </ScrollArea>,
    )

    const scrollBar = container.querySelector('[data-title-bar-chrome-region="no-drag"]')

    expect(scrollBar).not.toBeNull()
    expect(scrollBar?.className).toContain('h-2')
    expect((container.firstElementChild as HTMLElement | null)?.dataset.scrollbarMode).toBe('default')
  })

  test('marks compact scrollbar mode on the scroll area root', () => {
    const { container } = renderInJsdom(
      <ScrollArea orientation="horizontal" scrollbarMode="compact" type="always">
        <div className="w-[1000px]">wide content</div>
      </ScrollArea>,
    )

    expect((container.firstElementChild as HTMLElement | null)?.dataset.scrollbarMode).toBe('compact')
  })

  test('attaches viewportOnScroll to the scrollable viewport', () => {
    const onScroll = vi.fn()
    const { container } = renderInJsdom(
      <ScrollArea viewportOnScroll={onScroll}>
        <div>content</div>
      </ScrollArea>,
    )

    const viewport = container.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
    expect(viewport).not.toBeNull()

    if (viewport) fireEvent.scroll(viewport)

    expect(onScroll).toHaveBeenCalledTimes(1)
  })
})
