import { computed, readonly, ref, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'

export const DEFAULT_LOADING_DELAY_MS = 120
export const DEFAULT_MIN_LOADING_VISIBLE_MS = 250

interface LoadingVisibilityOptions {
  delayMs?: number
  minVisibleMs?: number
}

export function useLoadingVisibility(
  loading: MaybeRefOrGetter<boolean>,
  options?: LoadingVisibilityOptions,
): Readonly<Ref<boolean>> {
  const delayMs = options?.delayMs ?? DEFAULT_LOADING_DELAY_MS
  const minVisibleMs = options?.minVisibleMs ?? DEFAULT_MIN_LOADING_VISIBLE_MS
  const visible = ref(false)
  let shownAt: number | null = null

  // Visibility owns delay/minimum-duration timers, so it must synchronize with
  // the external loading signal and cancel the obsolete timer on every change.
  watch(
    () => toValue(loading),
    (nextLoading, _previousLoading, onCleanup) => {
      if (nextLoading) {
        if (visible.value) return
        const timeout = window.setTimeout(() => {
          if (!toValue(loading)) return
          shownAt = Date.now()
          visible.value = true
        }, delayMs)
        onCleanup(() => window.clearTimeout(timeout))
        return
      }

      if (!visible.value) return
      const elapsed = shownAt === null ? minVisibleMs : Date.now() - shownAt
      const timeout = window.setTimeout(
        () => {
          shownAt = null
          visible.value = false
        },
        Math.max(0, minVisibleMs - elapsed),
      )
      onCleanup(() => window.clearTimeout(timeout))
    },
    { immediate: true },
  )

  return readonly(visible)
}

export function useVisibleLoadingValue<T>(
  value: MaybeRefOrGetter<T | null>,
  options?: LoadingVisibilityOptions,
): ComputedRef<T | null> {
  const visible = useLoadingVisibility(() => toValue(value) !== null, options)
  let lastValue = toValue(value)

  return computed(() => {
    const currentValue = toValue(value)
    if (currentValue !== null) lastValue = currentValue
    return visible.value ? lastValue : null
  })
}
