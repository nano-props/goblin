import { useEffect, useState, type RefObject } from 'react'

export function useElementInlineSize(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [inlineSize, setInlineSize] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    const element = ref.current
    if (!element) return

    const update = (next: number) => {
      if (next <= 0) return
      setInlineSize((current) => (current !== null && Math.abs(current - next) <= 0.5 ? current : next))
    }

    update(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, ref])

  return inlineSize
}
