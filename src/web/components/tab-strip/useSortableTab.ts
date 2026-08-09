import { useSortable } from '@dnd-kit/vue/sortable'
import { computed, ref } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'

interface UseSortableTabResult {
  containerRef: Ref<HTMLElement | null>
  setButtonRef: (node: HTMLButtonElement | null) => void
  isDragging: ComputedRef<boolean>
}

export function useSortableTab(
  id: MaybeRefOrGetter<string>,
  index: MaybeRefOrGetter<number>,
  options?: {
    disabled?: MaybeRefOrGetter<boolean>
    onButtonRef?: (node: HTMLButtonElement | null) => void
  },
): UseSortableTabResult {
  const containerRef = ref<HTMLElement | null>(null)
  const buttonRef = ref<HTMLButtonElement | null>(null)
  const sortable = useSortable({
    id,
    index,
    group: 'workspace-pane-tabs',
    element: containerRef,
    handle: buttonRef,
    disabled: options?.disabled,
  })

  return {
    containerRef,
    setButtonRef: (node) => {
      buttonRef.value = node
      options?.onButtonRef?.(node)
    },
    isDragging: computed(() => sortable.isDragging.value),
  }
}
