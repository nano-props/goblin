import { useCallback, useEffect, useRef, useState } from 'react'

export type LatestAsyncTaskResult<T> = { status: 'current'; value: T } | { status: 'stale' }

/**
 * Latest-wins async task helper.
 *
 * Each new run supersedes the previous one. When an older task eventually
 * settles, its result is reported as `stale` so callers can skip applying it.
 * This is useful for dialogs and forms whose newest submission/open cycle
 * should own pending/error state.
 */
export function useLatestAsyncTask() {
  const [pending, setPending] = useState(false)
  const currentTaskIdRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  // Locally supersede any in-flight task and clear pending UI state. This does
  // not abort the underlying async work; it only invalidates its eventual
  // result for this hook consumer.
  const reset = useCallback(() => {
    currentTaskIdRef.current += 1
    if (mountedRef.current) setPending(false)
  }, [])

  const runLatest = useCallback(async <T>(fn: () => Promise<T>): Promise<LatestAsyncTaskResult<T>> => {
    const taskId = currentTaskIdRef.current + 1
    currentTaskIdRef.current = taskId
    setPending(true)
    try {
      const value = await fn()
      return currentTaskIdRef.current === taskId ? { status: 'current', value } : { status: 'stale' }
    } catch (err) {
      if (currentTaskIdRef.current !== taskId) return { status: 'stale' }
      throw err
    } finally {
      if (currentTaskIdRef.current === taskId && mountedRef.current) setPending(false)
    }
  }, [])

  return {
    pending,
    reset,
    runLatest,
  }
}
