import type { Modifier } from '@dnd-kit/core'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parsePixelLength(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rightBoundaryGapPx(node: HTMLElement | null | undefined): number {
  const parent = node?.parentElement
  if (!parent || typeof globalThis.getComputedStyle !== 'function') return 0
  const styles = globalThis.getComputedStyle(parent)
  return parsePixelLength(styles.columnGap || styles.gap)
}

export function createRestrictToTabStripBounds(options: {
  rightBoundaryRef?: { current: HTMLElement | null }
}): Modifier {
  return ({ activeNodeRect, containerNodeRect, draggingNodeRect, scrollableAncestorRects, transform, windowRect }) => {
    const horizontalTransform = { ...transform, y: 0 }
    const draggableRect = draggingNodeRect ?? activeNodeRect
    const bounds = scrollableAncestorRects[0] ?? containerNodeRect ?? windowRect
    if (!draggableRect || !bounds) return horizontalTransform
    const minX = bounds.left - draggableRect.left
    const rightBoundaryNode = options.rightBoundaryRef?.current ?? null
    const rightBoundaryRect = rightBoundaryNode?.getBoundingClientRect() ?? null
    const maxRight = rightBoundaryRect
      ? Math.min(bounds.right, rightBoundaryRect.left - rightBoundaryGapPx(rightBoundaryNode))
      : bounds.right
    const maxX = maxRight - draggableRect.right
    return { ...horizontalTransform, x: clamp(horizontalTransform.x, minX, maxX) }
  }
}
