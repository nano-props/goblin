import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface CollapseTransitionProps {
  children: ReactNode
  duration?: number
  present?: boolean
}

export function CollapseTransition({ children, duration = 200, present = true }: CollapseTransitionProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const initial = useRef(true)
  const targetRef = useRef(0)
  const transitionCleanupRef = useRef<(() => void) | null>(null)
  const [renderedChildren, setRenderedChildren] = useState<ReactNode>(() => (present ? children : null))

  useLayoutEffect(() => {
    if (present) setRenderedChildren(children)
  }, [children, present])

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    if (initial.current) {
      outer.style.transition = 'none'
      const h = present ? inner.scrollHeight : 0
      outer.style.height = `${h}px`
      outer.style.opacity = present && h > 0 ? '1' : '0'
      targetRef.current = h
      initial.current = false
      requestAnimationFrame(() => {
        outer.style.transition = `height ${duration}ms ease-in-out, opacity ${duration}ms ease-in-out`
      })
      return
    }

    const h = present ? inner.scrollHeight : 0
    if (Math.abs(h - targetRef.current) > 0.5) {
      transitionCleanupRef.current?.()
      transitionCleanupRef.current = null
      outer.style.overflow = 'hidden'
      // Defensive: any future child that paints an outer halo (box-shadow,
      // outline) within 4px of the box edge won't be clipped by the
      // height-transition overflow. Combined with the inset focus-ring
      // convention used by the UI primitives, this makes the component
      // robust to clip-fragile decorations.
      outer.style.overflowClipMargin = '4px'
      outer.style.height = `${h}px`
      outer.style.opacity = present && h > 0 ? '1' : '0'
      targetRef.current = h
      const handleTransitionEnd = () => {
        if (present) outer.style.height = 'auto'
        outer.style.overflow = ''
        outer.style.overflowClipMargin = ''
        transitionCleanupRef.current = null
        if (!present) setRenderedChildren(null)
      }
      outer.addEventListener('transitionend', handleTransitionEnd, { once: true })
      transitionCleanupRef.current = () => outer.removeEventListener('transitionend', handleTransitionEnd)
    } else if (!present) {
      setRenderedChildren(null)
    }
  }, [duration, present, renderedChildren])

  useLayoutEffect(() => {
    return () => {
      transitionCleanupRef.current?.()
      transitionCleanupRef.current = null
    }
  }, [])

  return (
    <div ref={outerRef}>
      <div ref={innerRef}>{renderedChildren}</div>
    </div>
  )
}
