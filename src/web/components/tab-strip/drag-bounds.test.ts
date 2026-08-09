import { describe, expect, test } from 'vitest'
import { restrictToTabStripBounds } from '#/web/components/tab-strip/drag-bounds.ts'

describe('restrictToTabStripBounds', () => {
  test('keeps dragging horizontal and inside the visible viewport', () => {
    expect(
      restrictToTabStripBounds({
        transform: { x: 500, y: 12 },
        draggableRect: { left: 100, right: 220 },
        viewportRect: { left: 0, right: 300 },
      }),
    ).toEqual({ x: 80, y: 0 })

    expect(
      restrictToTabStripBounds({
        transform: { x: -500, y: -12 },
        draggableRect: { left: 100, right: 220 },
        viewportRect: { left: 20, right: 300 },
      }),
    ).toEqual({ x: -80, y: 0 })
  })

  test('stops before the fixed action button and its layout gap', () => {
    expect(
      restrictToTabStripBounds({
        transform: { x: 500, y: 12 },
        draggableRect: { left: 100, right: 220 },
        viewportRect: { left: 0, right: 300 },
        rightBoundaryRect: { left: 260 },
        rightBoundaryGap: 4,
      }),
    ).toEqual({ x: 36, y: 0 })
  })

  test('still locks the vertical axis before DOM geometry is available', () => {
    expect(
      restrictToTabStripBounds({
        transform: { x: 25, y: 12 },
        draggableRect: null,
        viewportRect: null,
      }),
    ).toEqual({ x: 25, y: 0 })
  })
})
