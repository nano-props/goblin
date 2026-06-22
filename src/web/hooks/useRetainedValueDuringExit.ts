import { useEffect, useRef, useState } from 'react'

interface UseRetainedValueDuringExitOptions<T> {
  value: T | null
  active: boolean
  retainMs: number
  resetKey?: unknown
}

export function useRetainedValueDuringExit<T>({
  value,
  active,
  retainMs,
  resetKey,
}: UseRetainedValueDuringExitOptions<T>): T | null {
  const retainedValueRef = useRef<T | null>(active ? value : null)
  const resetKeyRef = useRef(resetKey)
  const [, forceRender] = useState(0)

  // Keep the entered value available to the first exiting render without waiting
  // for an effect. That avoids a one-frame empty pane during slide-out.
  if (!Object.is(resetKeyRef.current, resetKey)) {
    resetKeyRef.current = resetKey
    retainedValueRef.current = active ? value : null
  } else if (active) {
    retainedValueRef.current = value
  }

  useEffect(() => {
    if (active || retainedValueRef.current === null) return

    const timeout = window.setTimeout(() => {
      retainedValueRef.current = null
      forceRender((version) => version + 1)
    }, retainMs)

    return () => window.clearTimeout(timeout)
  }, [active, resetKey, retainMs])

  return active ? value : retainedValueRef.current
}
