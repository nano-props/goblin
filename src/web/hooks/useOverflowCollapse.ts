import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Detect when a set of children overflow their container and should collapse
 * into a compact representation. Mirrors the pattern used in both
 * BranchActionControls and TerminalTabs.
 *
 * @param layoutKey A string that changes when the measured content changes
 *                  (e.g. items.map(i => i.id).join('|')).
 * @returns refs to attach to the visible container and the invisible measure
 *          element, plus the current collapsed state.
 */
export function useOverflowCollapse(layoutKey: string) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return

    const check = () => {
      const next = measure.scrollWidth > container.clientWidth + 1
      setCollapsed((current) => (current === next ? current : next))
    }
    check()

    const ResizeObserverCtor = globalThis.ResizeObserver
    if (!ResizeObserverCtor) {
      window.addEventListener('resize', check)
      return () => window.removeEventListener('resize', check)
    }

    const observer = new ResizeObserverCtor(check)
    observer.observe(container)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [layoutKey])

  return { containerRef, measureRef, collapsed }
}
