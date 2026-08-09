import { useEventListener, useResizeObserver } from '@vueuse/core'
import { onMounted, readonly, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

export function useOverflowCollapse(layoutKey: MaybeRefOrGetter<string>): {
  containerRef: Ref<HTMLDivElement | null>
  measureRef: Ref<HTMLDivElement | null>
  collapsed: Readonly<Ref<boolean>>
} {
  const containerRef = ref<HTMLDivElement | null>(null)
  const measureRef = ref<HTMLDivElement | null>(null)
  const collapsed = ref(false)

  function check(): void {
    if (!containerRef.value || !measureRef.value) return
    collapsed.value = measureRef.value.scrollWidth > containerRef.value.clientWidth + 1
  }

  if (typeof ResizeObserver === 'undefined') useEventListener(window, 'resize', check)
  else useResizeObserver([containerRef, measureRef], check)
  onMounted(check)

  // Content identity can change without changing either measured element's
  // box, so remeasure once after that projection has rendered.
  watch(() => toValue(layoutKey), check, { flush: 'post' })

  return { containerRef, measureRef, collapsed: readonly(collapsed) }
}
