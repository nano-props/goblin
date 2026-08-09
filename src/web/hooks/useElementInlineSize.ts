import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import { useElementSize } from '@vueuse/core'

export function useElementInlineSize(
  element: Ref<HTMLElement | null>,
  enabled: MaybeRefOrGetter<boolean>,
): ComputedRef<number | null> {
  const { width } = useElementSize(element)
  return computed(() => (toValue(enabled) && width.value > 0 ? width.value : null))
}
