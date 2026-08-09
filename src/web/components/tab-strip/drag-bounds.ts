import { configurator, Modifier } from '@dnd-kit/abstract'
import type { DragOperation } from '@dnd-kit/abstract'
import type { DragDropManager } from '@dnd-kit/dom'

interface RestrictToTabStripBoundsOptions {
  viewport: () => HTMLElement | null
  rightBoundary: () => HTMLElement | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parsePixelLength(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rightBoundaryGapPx(node: HTMLElement | null): number {
  const parent = node?.parentElement
  if (!parent || typeof globalThis.getComputedStyle !== 'function') return 0
  const styles = globalThis.getComputedStyle(parent)
  return parsePixelLength(styles.columnGap || styles.gap)
}

export function restrictToTabStripBounds(input: {
  transform: { x: number; y: number }
  draggableRect: { left: number; right: number } | null
  viewportRect: { left: number; right: number } | null
  rightBoundaryRect?: { left: number } | null
  rightBoundaryGap?: number
}): { x: number; y: number } {
  const horizontalTransform = { ...input.transform, y: 0 }
  if (!input.draggableRect || !input.viewportRect) return horizontalTransform

  const minX = input.viewportRect.left - input.draggableRect.left
  const maxRight = input.rightBoundaryRect
    ? Math.min(input.viewportRect.right, input.rightBoundaryRect.left - (input.rightBoundaryGap ?? 0))
    : input.viewportRect.right
  const maxX = maxRight - input.draggableRect.right
  return { ...horizontalTransform, x: clamp(horizontalTransform.x, minX, maxX) }
}

class RestrictToTabStripBounds extends Modifier<DragDropManager, RestrictToTabStripBoundsOptions> {
  apply({ shape, transform }: DragOperation): { x: number; y: number } {
    const viewport = this.options?.viewport() ?? null
    const rightBoundary = this.options?.rightBoundary() ?? null
    const currentWidth = shape?.current.boundingRectangle.width ?? 0
    const initialCenterX = shape?.initial.center.x ?? 0
    const draggableLeft = initialCenterX - currentWidth / 2

    return restrictToTabStripBounds({
      transform,
      draggableRect: shape ? { left: draggableLeft, right: draggableLeft + currentWidth } : null,
      viewportRect: viewport?.getBoundingClientRect() ?? null,
      rightBoundaryRect: rightBoundary?.getBoundingClientRect() ?? null,
      rightBoundaryGap: rightBoundaryGapPx(rightBoundary),
    })
  }

  static configure = configurator(RestrictToTabStripBounds)
}

export function createRestrictToTabStripBounds(options: RestrictToTabStripBoundsOptions) {
  return RestrictToTabStripBounds.configure(options)
}
