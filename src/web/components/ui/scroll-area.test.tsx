// @vitest-environment jsdom

import { fireEvent } from '@testing-library/vue'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'

describe('ScrollArea', () => {
  test('marks scrollbars as no-drag window chrome regions', async () => {
    const { container } = renderInJsdom(
      <ScrollArea orientation="horizontal" type="always">
        <div class="w-[1000px]">wide content</div>
      </ScrollArea>,
    )

    const scrollBar = container.querySelector('[data-title-bar-chrome-region="no-drag"]')

    expect(scrollBar).not.toBeNull()
    expect(scrollBar?.className).toContain('h-2')
    expect((container.firstElementChild as HTMLElement | null)?.dataset.scrollbarMode).toBe('default')
  })

  test('marks compact scrollbar mode on the scroll area root', async () => {
    const { container } = renderInJsdom(
      <ScrollArea orientation="horizontal" scrollbarMode="compact" type="always">
        <div class="w-[1000px]">wide content</div>
      </ScrollArea>,
    )

    expect((container.firstElementChild as HTMLElement | null)?.dataset.scrollbarMode).toBe('compact')
  })

  test('animates only scrollbar thickness, never the measured thumb length', () => {
    const horizontal = renderInJsdom(
      <ScrollArea orientation="horizontal" type="always">
        <div class="w-[1000px]">wide content</div>
      </ScrollArea>,
    )
    const vertical = renderInJsdom(
      <ScrollArea orientation="vertical" type="always">
        <div class="h-[1000px]">tall content</div>
      </ScrollArea>,
    )

    const horizontalThumb = horizontal.container.querySelector(
      '[data-title-bar-chrome-region="no-drag"]',
    )?.firstElementChild
    const verticalThumb = vertical.container.querySelector(
      '[data-title-bar-chrome-region="no-drag"]',
    )?.firstElementChild
    expect(horizontalThumb?.className).toContain('transition-[background-color,height]')
    expect(horizontalThumb?.className).not.toContain('transition-[background-color,width]')
    expect(verticalThumb?.className).toContain('transition-[background-color,width]')
    expect(verticalThumb?.className).not.toContain('transition-[background-color,height]')
  })

  test('applies caller classes exactly once', async () => {
    const { container } = renderInJsdom(<ScrollArea class="caller-marker">content</ScrollArea>)
    const root = container.firstElementChild
    expect(root?.className.split(/\s+/).filter((token) => token === 'caller-marker')).toHaveLength(1)
  })

  test('attaches viewportOnScroll to the scrollable viewport', async () => {
    const onScroll = vi.fn()
    const { container } = renderInJsdom(
      <ScrollArea viewportOnScroll={onScroll}>
        <div>content</div>
      </ScrollArea>,
    )

    const viewport = container.querySelector<HTMLDivElement>('[data-reka-scroll-area-viewport]')
    expect(viewport).not.toBeNull()

    if (viewport) await fireEvent.scroll(viewport)

    expect(onScroll).toHaveBeenCalledTimes(1)
  })
})
