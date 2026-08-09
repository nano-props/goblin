import { toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

interface RowIndexVirtualizer {
  scrollToIndex(index: number, options?: { align?: 'start' | 'center' | 'end' | 'auto' }): void
}

interface UseRestoreTopVisibleRowIndexInput {
  readonly restoreKey: MaybeRefOrGetter<string>
  readonly topVisibleRowIndex: MaybeRefOrGetter<number>
  readonly enabled: MaybeRefOrGetter<boolean>
  readonly ready: MaybeRefOrGetter<boolean>
  readonly rowCount: MaybeRefOrGetter<number>
  readonly scrollElement: MaybeRefOrGetter<Element | null>
  readonly virtualizer: MaybeRefOrGetter<RowIndexVirtualizer>
}

export function useRestoreTopVisibleRowIndex(input: UseRestoreTopVisibleRowIndexInput): void {
  let restoredKey: string | null = null

  // Restoration is an imperative projection that becomes valid only after all
  // route, data, and virtualizer inputs are ready.
  watch(
    [
      () => toValue(input.restoreKey),
      () => toValue(input.topVisibleRowIndex),
      () => toValue(input.enabled),
      () => toValue(input.ready),
      () => toValue(input.rowCount),
      () => toValue(input.scrollElement),
      () => toValue(input.virtualizer),
    ] as const,
    ([restoreKey, topVisibleRowIndex, enabled, ready, rowCount, scrollElement, virtualizer]) => {
      if (!enabled || !ready || !scrollElement || restoredKey === restoreKey || rowCount <= 0) return
      virtualizer.scrollToIndex(Math.min(topVisibleRowIndex, rowCount - 1), { align: 'start' })
      restoredKey = restoreKey
    },
    { flush: 'post' },
  )
}
