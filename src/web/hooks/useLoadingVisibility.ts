import { useEffect, useRef, useState } from 'react'
export const DEFAULT_LOADING_DELAY_MS = 150
export const DEFAULT_MIN_LOADING_VISIBLE_MS = 300

interface LoadingVisibilityOptions {
  delayMs?: number
  minVisibleMs?: number
}

export function useLoadingVisibility(loading: boolean, options?: LoadingVisibilityOptions): boolean {
  const delayMs = options?.delayMs ?? DEFAULT_LOADING_DELAY_MS
  const minVisibleMs = options?.minVisibleMs ?? DEFAULT_MIN_LOADING_VISIBLE_MS
  const [visible, setVisible] = useState(false)
  const visibleRef = useRef(false)
  const shownAtRef = useRef<number | null>(null)

  useEffect(() => {
    let timer: number | undefined
    if (loading) {
      if (visibleRef.current) return
      timer = window.setTimeout(() => {
        shownAtRef.current = Date.now()
        visibleRef.current = true
        setVisible(true)
      }, delayMs)
    } else {
      if (!visibleRef.current) return
      const shownAt = shownAtRef.current
      const elapsed = shownAt === null ? minVisibleMs : Date.now() - shownAt
      timer = window.setTimeout(
        () => {
          shownAtRef.current = null
          visibleRef.current = false
          setVisible(false)
        },
        Math.max(0, minVisibleMs - elapsed),
      )
    }
    return () => window.clearTimeout(timer)
  }, [delayMs, loading, minVisibleMs])

  return visible
}

export function useVisibleLoadingValue<T>(value: T | null, options?: LoadingVisibilityOptions): T | null {
  const visible = useLoadingVisibility(value !== null, options)
  const [lastValue, setLastValue] = useState<T | null>(value)

  useEffect(() => {
    // Keep the last non-null value through the min-visible window so delayed
    // labels do not disappear before the loading affordance itself hides.
    if (value !== null) setLastValue((current) => (Object.is(current, value) ? current : value))
  }, [value])

  return visible ? lastValue : null
}
