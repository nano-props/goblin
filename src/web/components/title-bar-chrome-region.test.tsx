// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import {
  NativeDragPlate,
  TitleBarDragRegion,
  TitleBarInteractiveRegion,
  TitleBarNoDragRegion,
} from '#/web/components/title-bar-chrome-region.tsx'
import { renderInJsdom } from '#/test-utils/render.tsx'

describe('window chrome regions', () => {
  test('marks a padded drag region for native window controls', () => {
    const { container } = renderInJsdom(<TitleBarDragRegion data-testid="chrome" className="bg-card" />)

    const chrome = container.querySelector<HTMLElement>('[data-testid="chrome"]')
    expect(chrome?.dataset.titleBarChromeRegion).toBe('drag')
    expect(chrome?.className).toContain('title-bar-chrome')
    expect(chrome?.className).toContain('bg-card')
  })

  test('marks an unpadded drag region for toolbar remainder space', () => {
    const { container } = renderInJsdom(
      <TitleBarDragRegion reserveWindowControls={false} data-testid="chrome" />,
    )

    const chrome = container.querySelector<HTMLElement>('[data-testid="chrome"]')
    expect(chrome?.dataset.titleBarChromeRegion).toBe('drag')
    expect(chrome?.className).toContain('app-drag-region')
    expect(chrome?.className).not.toContain('title-bar-chrome')
  })

  test('marks a transparent native drag plate without reserving window controls', () => {
    const { container } = renderInJsdom(<NativeDragPlate data-testid="plate" className="z-30" />)

    const plate = container.querySelector<HTMLElement>('[data-testid="plate"]')
    expect(plate?.dataset.titleBarChromeRegion).toBe('drag')
    expect(plate?.getAttribute('aria-hidden')).toBe('true')
    expect(plate?.className).toContain('app-drag-region')
    expect(plate?.className).toContain('pointer-events-auto')
    expect(plate?.className).toContain('absolute')
    expect(plate?.className).toContain('bg-transparent')
    expect(plate?.className).toContain('z-30')
    expect(plate?.className).not.toContain('title-bar-chrome')
  })

  test('marks an interactive region as no-drag without adding layout chrome', () => {
    const { container } = renderInJsdom(
      <TitleBarInteractiveRegion data-testid="interactive" className="flex-1" />,
    )

    const interactive = container.querySelector<HTMLElement>('[data-testid="interactive"]')
    expect(interactive?.dataset.titleBarChromeRegion).toBe('interactive')
    expect(interactive?.hasAttribute('data-interactive')).toBe(true)
    expect(interactive?.className).toContain('flex-1')
    expect(interactive?.className).not.toContain('title-bar-chrome')
    expect(interactive?.className).not.toContain('app-drag-region')
  })

  test('can mark a child component root as the interactive region', () => {
    const { container } = renderInJsdom(
      <TitleBarInteractiveRegion asChild>
        <div data-testid="interactive-child" className="h-full" />
      </TitleBarInteractiveRegion>,
    )

    const interactive = container.querySelector<HTMLElement>('[data-testid="interactive-child"]')
    expect(interactive?.dataset.titleBarChromeRegion).toBe('interactive')
    expect(interactive?.hasAttribute('data-interactive')).toBe(true)
    expect(interactive?.className).toContain('h-full')
  })

  test('marks a passive no-drag carve-out without making it interactive', () => {
    const { container } = renderInJsdom(<TitleBarNoDragRegion data-testid="no-drag" className="size-8" />)

    const noDrag = container.querySelector<HTMLElement>('[data-testid="no-drag"]')
    expect(noDrag?.dataset.titleBarChromeRegion).toBe('no-drag')
    expect(noDrag?.hasAttribute('data-interactive')).toBe(false)
    expect(noDrag?.className).toContain('size-8')
  })

  test('can mark a child component root as a passive no-drag carve-out', () => {
    const { container } = renderInJsdom(
      <TitleBarNoDragRegion asChild>
        <div data-testid="no-drag-child" className="absolute" />
      </TitleBarNoDragRegion>,
    )

    const noDrag = container.querySelector<HTMLElement>('[data-testid="no-drag-child"]')
    expect(noDrag?.dataset.titleBarChromeRegion).toBe('no-drag')
    expect(noDrag?.hasAttribute('data-interactive')).toBe(false)
    expect(noDrag?.className).toContain('absolute')
  })
})
