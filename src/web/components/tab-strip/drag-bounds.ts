import type { Modifier } from '@dnd-kit/core'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
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
    const rightBoundaryRect = options.rightBoundaryRef?.current?.getBoundingClientRect() ?? null
    const maxRight = rightBoundaryRect ? Math.min(bounds.right, rightBoundaryRect.left) : bounds.right
    const maxX = maxRight - draggableRect.right
    return { ...horizontalTransform, x: clamp(horizontalTransform.x, minX, maxX) }
  }
}
