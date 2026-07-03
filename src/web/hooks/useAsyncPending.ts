import { useCallback, useEffect, useRef, useState } from 'react'
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === 'function'
}

/**
 * Single-flight async action helper for UI event handlers.
 *
 * - The first async call marks the action pending until it settles.
 * - Additional calls while one is in flight are ignored.
 * - Synchronous callbacks are not marked pending and keep sync throws sync.
 *
 * Use this for buttons and controllers that want "ignore duplicate trigger
 * until settle" semantics. For forms where newer submissions should supersede
 * older results, prefer `useLatestAsyncTask`.
 */
export function useAsyncPending<T>({ resetKey }: { resetKey?: string } = {}) {
  const [pendingState, setPendingState] = useState<{ id: T; resetKey: string | undefined } | null>(null)
  const pendingRef = useRef<{ id: T; resetKey: string | undefined; operationId: number } | null>(null)
  const nextOperationIdRef = useRef(0)
  const mountedRef = useRef(true)
  const pending = pendingState && pendingState.resetKey === resetKey ? pendingState.id : null

  useEffect(
    () => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
      }
    },
    [],
  )

  // Keep sync throws synchronous. Promise rejections are intentionally left to
  // callers so each action boundary can decide whether to show a toast, surface
  // a dialog error, or let the error propagate. Pending is only tracked for
  // async work; duplicate async triggers are dropped until the in-flight action
  // settles.
  const run = useCallback((id: T, fn: () => void | Promise<unknown>) => {
    if (pendingRef.current !== null && pendingRef.current.resetKey === resetKey) return
    const result = fn()
    if (!isPromiseLike(result)) return result
    const operationId = nextOperationIdRef.current + 1
    nextOperationIdRef.current = operationId
    pendingRef.current = { id, resetKey, operationId }
    setPendingState({ id, resetKey })
    return Promise.resolve(result).finally(() => {
      if (pendingRef.current?.operationId !== operationId) return
      pendingRef.current = null
      if (mountedRef.current) setPendingState(null)
    })
  }, [resetKey])

  return {
    pending,
    isPending: pending !== null,
    hasPending: () => pendingRef.current !== null && pendingRef.current.resetKey === resetKey,
    run,
  }
}
