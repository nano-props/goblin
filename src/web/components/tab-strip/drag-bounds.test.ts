import { describe, expect, test } from 'vitest'
import { createRestrictToTabStripBounds } from '#/web/components/tab-strip/drag-bounds.ts'

describe('createRestrictToTabStripBounds', () => {
  test('keeps dragging within the base visible bounds when there is no action boundary', () => {
    const modifier = createRestrictToTabStripBounds({})
    const result = modifier({
      transform: { x: 500, y: 12, scaleX: 1, scaleY: 1 },
      activeNodeRect: rect({ left: 100, right: 220 }),
      draggingNodeRect: null,
      containerNodeRect: rect({ left: 0, right: 300 }),
      overlayNodeRect: null,
      scrollableAncestors: [],
      scrollableAncestorRects: [],
      windowRect: rect({ left: 0, right: 1000 }),
      active: null as never,
      activatorEvent: null as never,
      over: null,
    })

    expect(result).toMatchObject({ x: 80, y: 0 })
  })

  test('caps the right boundary at the action button left edge', () => {
    const modifier = createRestrictToTabStripBounds({
      rightBoundaryRef: {
        current: {
          getBoundingClientRect: () => rect({ left: 260, right: 292 }),
        } as HTMLElement,
      },
    })
    const result = modifier({
      transform: { x: 500, y: 12, scaleX: 1, scaleY: 1 },
      activeNodeRect: rect({ left: 100, right: 220 }),
      draggingNodeRect: null,
      containerNodeRect: rect({ left: 0, right: 300 }),
      overlayNodeRect: null,
      scrollableAncestors: [],
      scrollableAncestorRects: [],
      windowRect: rect({ left: 0, right: 1000 }),
      active: null as never,
      activatorEvent: null as never,
      over: null,
    })

    expect(result).toMatchObject({ x: 40, y: 0 })
  })
})

function rect({ left, right }: { left: number; right: number }): DOMRect {
  return {
    left,
    right,
    top: 0,
    bottom: 20,
    width: right - left,
    height: 20,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}
