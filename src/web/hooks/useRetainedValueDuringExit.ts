import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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
  const commitVersionRef = useRef(0)
  const [, forceRender] = useState(0)
  const resetKeyChangedSinceCommit = !Object.is(resetKeyRef.current, resetKey)

  // Record only committed active values. Exiting renders can synchronously read
  // the previous committed value without writing mutable state during render.
  useLayoutEffect(() => {
    if (!Object.is(resetKeyRef.current, resetKey)) {
      resetKeyRef.current = resetKey
      retainedValueRef.current = active ? value : null
      commitVersionRef.current += 1
      return
    }

    if (active) {
      retainedValueRef.current = value
      commitVersionRef.current += 1
    }
  }, [active, resetKey, value])

  useEffect(() => {
    if (active || retainedValueRef.current === null) return

    const exitVersion = commitVersionRef.current
    const timeout = window.setTimeout(() => {
      if (commitVersionRef.current !== exitVersion) return
      if (!Object.is(resetKeyRef.current, resetKey)) return
      retainedValueRef.current = null
      forceRender((version) => version + 1)
    }, retainMs)

    return () => window.clearTimeout(timeout)
  }, [active, resetKey, retainMs])

  if (resetKeyChangedSinceCommit) return active ? value : null
  return active ? value : retainedValueRef.current
}
