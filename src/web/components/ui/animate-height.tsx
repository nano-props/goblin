import { useLayoutEffect, useRef } from 'react'

export function AnimateHeight({
  children,
  duration = 200,
}: {
  children: React.ReactNode
  duration?: number
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const initial = useRef(true)
  const targetRef = useRef(0)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    if (initial.current) {
      outer.style.transition = 'none'
      const h = inner.scrollHeight
      outer.style.height = `${h}px`
      targetRef.current = h
      initial.current = false
      requestAnimationFrame(() => {
        outer.style.transition = `height ${duration}ms ease-in-out`
      })
      return
    }

    const h = inner.scrollHeight
    if (Math.abs(h - targetRef.current) > 0.5) {
      outer.style.overflow = 'hidden'
      outer.style.height = `${h}px`
      targetRef.current = h
      outer.addEventListener(
        'transitionend',
        () => {
          outer.style.overflow = ''
        },
        { once: true },
      )
    }
  })

  return (
    <div ref={outerRef}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
