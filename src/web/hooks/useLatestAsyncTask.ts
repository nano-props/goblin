import { onScopeDispose, readonly, ref } from 'vue'
import type { Ref } from 'vue'

export type LatestAsyncTaskResult<T> = { status: 'current'; value: T } | { status: 'stale' }

/** Latest-wins async task state for forms and replaceable projections. */
export function useLatestAsyncTask(): {
  pending: Readonly<Ref<boolean>>
  reset: () => void
  runLatest: <T>(fn: () => Promise<T>) => Promise<LatestAsyncTaskResult<T>>
} {
  const pending = ref(false)
  let currentTaskId = 0
  let disposed = false

  onScopeDispose(() => {
    disposed = true
  })

  function reset(): void {
    currentTaskId += 1
    if (!disposed) pending.value = false
  }

  async function runLatest<T>(fn: () => Promise<T>): Promise<LatestAsyncTaskResult<T>> {
    currentTaskId += 1
    const taskId = currentTaskId
    pending.value = true
    try {
      const value = await fn()
      return currentTaskId === taskId ? { status: 'current', value } : { status: 'stale' }
    } catch (error) {
      if (currentTaskId !== taskId) return { status: 'stale' }
      throw error
    } finally {
      if (currentTaskId === taskId && !disposed) pending.value = false
    }
  }

  return { pending: readonly(pending), reset, runLatest }
}
