import { computed, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

interface UseRetainedValueDuringExitOptions<T> {
  value: MaybeRefOrGetter<T | null>
  active: MaybeRefOrGetter<boolean>
  retainMs: number
  resetKey?: MaybeRefOrGetter<unknown>
}

/** Retains the last active value until a fixed exit transition completes. */
export function useRetainedValueDuringExit<T>({
  value,
  active,
  retainMs,
  resetKey,
}: UseRetainedValueDuringExitOptions<T>): ComputedRef<T | null> {
  const retainedValue = shallowRef<T | null>(null)
  let committedResetKey = toValue(resetKey)

  // The exit timer belongs only to the active/reset-key lifecycle. While the
  // view is inactive, value changes are unrelated projection updates and must
  // not restart that fixed window.
  watch(
    () => {
      const nextActive = toValue(active)
      const nextResetKey = toValue(resetKey)
      return nextActive
        ? { active: true as const, resetKey: nextResetKey, value: toValue(value) }
        : { active: false as const, resetKey: nextResetKey }
    },
    (projection, _previous, onCleanup) => {
      if (!Object.is(committedResetKey, projection.resetKey)) {
        committedResetKey = projection.resetKey
        retainedValue.value = projection.active ? projection.value : null
        return
      }

      if (projection.active) {
        retainedValue.value = projection.value
        return
      }
      if (retainedValue.value === null) return

      const timeout = window.setTimeout(() => {
        retainedValue.value = null
      }, retainMs)
      onCleanup(() => window.clearTimeout(timeout))
    },
    { immediate: true },
  )

  return computed(() => (toValue(active) ? toValue(value) : retainedValue.value))
}
