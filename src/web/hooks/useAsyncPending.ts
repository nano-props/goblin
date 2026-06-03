import { useCallback, useEffect, useRef, useState } from 'react'
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === 'function'
}

export function useAsyncPending<T>() {
  const [pending, setPending] = useState<T | null>(null)
  const pendingRef = useRef<T | null>(null)
  const mountedRef = useRef(true)

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  // Keep sync throws synchronous. Promise rejections are intentionally left to
  // callers so each action boundary can decide whether to show a toast, surface
  // a dialog error, or let the error propagate.
  const run = useCallback((id: T, fn: () => void | Promise<unknown>) => {
    if (pendingRef.current !== null) return
    const result = fn()
    if (!isPromiseLike(result)) return result
    pendingRef.current = id
    setPending(id)
    return Promise.resolve(result).finally(() => {
      pendingRef.current = null
      if (mountedRef.current) setPending(null)
    })
  }, [])

  return {
    pending,
    isPending: pending !== null,
    hasPending: () => pendingRef.current !== null,
    run,
  }
}
