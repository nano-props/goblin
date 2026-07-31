const ZEN_REVEAL_SURFACE_SELECTOR = '[data-floating-surface],[data-zen-reveal-surface]'

interface PointerCoordinates {
  clientX: number
  clientY: number
}

export function zenRevealHostRect(host: HTMLElement | null): DOMRect | null {
  const rect = host?.getBoundingClientRect()
  if (rect && rect.width > 0) return rect
  const parentRect = host?.parentElement?.getBoundingClientRect()
  return parentRect && parentRect.width > 0 ? parentRect : null
}

export function isPointerInsideElement(event: PointerCoordinates, element: HTMLElement | null): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

export function isPointerInsideRevealBounds(
  event: PointerCoordinates,
  host: HTMLElement | null,
  panel: HTMLElement | null,
): boolean {
  if (!host || !panel) return false
  const hostRect = host.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const width = panel.offsetWidth || panelRect.width
  if (hostRect.height <= 0 || width <= 0) return false

  return (
    event.clientX >= hostRect.left &&
    event.clientX <= hostRect.left + width &&
    event.clientY >= hostRect.top &&
    event.clientY <= hostRect.bottom
  )
}

export function isZenRevealSurfaceTarget(
  target: EventTarget | null,
  panel: HTMLElement | null,
  hitArea: HTMLElement | null,
  options: { includeClosedFloatingSurfaces?: boolean } = {},
): boolean {
  if (!(target instanceof Node)) return false
  if (panel?.contains(target) || hitArea?.contains(target)) return true

  const targetElement = target instanceof Element ? target : target.parentElement
  const surfaceElement = targetElement?.closest(ZEN_REVEAL_SURFACE_SELECTOR)
  if (!surfaceElement) return false
  if (
    options.includeClosedFloatingSurfaces === false &&
    surfaceElement.matches('[data-floating-surface][data-state="closed"]')
  ) {
    return false
  }
  return true
}
