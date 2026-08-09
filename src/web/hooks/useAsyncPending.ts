import { computed, onScopeDispose, shallowRef, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === 'function'
}

interface AsyncPendingEntry<T> {
  id: T
  resetKey: string | undefined
  operationId: number
}

/** Single-flight async action state for UI event handlers. */
export function useAsyncPending<T>({ resetKey }: { resetKey?: MaybeRefOrGetter<string | undefined> } = {}): {
  pending: ComputedRef<T | null>
  isPending: ComputedRef<boolean>
  hasPending: () => boolean
  run: (id: T, fn: () => void | Promise<unknown>) => void | Promise<unknown>
} {
  const pendingEntry = shallowRef<AsyncPendingEntry<T> | null>(null)
  let nextOperationId = 0
  let disposed = false

  onScopeDispose(() => {
    disposed = true
  })

  const currentResetKey = () => toValue(resetKey)
  const pending = computed(() => {
    const entry = pendingEntry.value
    if (!entry || entry.resetKey !== currentResetKey()) return null
    return entry.id
  })

  function hasPending(): boolean {
    return pendingEntry.value !== null && pendingEntry.value.resetKey === currentResetKey()
  }

  function run(id: T, fn: () => void | Promise<unknown>): void | Promise<unknown> {
    if (hasPending()) return
    const result = fn()
    if (!isPromiseLike(result)) return result

    nextOperationId += 1
    const entry = { id, resetKey: currentResetKey(), operationId: nextOperationId }
    pendingEntry.value = entry
    return Promise.resolve(result).finally(() => {
      if (pendingEntry.value?.operationId !== entry.operationId) return
      if (!disposed) pendingEntry.value = null
    })
  }

  return {
    pending,
    isPending: computed(() => pending.value !== null),
    hasPending,
    run,
  }
}
