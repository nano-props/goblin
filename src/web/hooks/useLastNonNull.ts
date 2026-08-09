import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

/**
 * Keeps the most recent non-null projection for the lifetime of the current
 * component scope. Dialog content can therefore remain stable while its exit
 * transition runs after authoritative state has already closed the dialog.
 */
export function useLastNonNull<T>(value: MaybeRefOrGetter<T | null>): ComputedRef<T | null> {
  let lastValue: T | null = null

  return computed(() => {
    const currentValue = toValue(value)
    if (currentValue !== null) lastValue = currentValue
    return currentValue ?? lastValue
  })
}
