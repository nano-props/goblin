import { useLayoutEffect, useRef } from 'react'

interface RowIndexVirtualizer {
  scrollToIndex(index: number, options?: { align?: 'start' | 'center' | 'end' | 'auto' }): void
}

interface UseRestoreTopVisibleRowIndexInput {
  readonly restoreKey: string
  readonly topVisibleRowIndex: number
  readonly enabled: boolean
  readonly ready: boolean
  readonly rowCount: number
  readonly virtualizer: RowIndexVirtualizer
}

export function useRestoreTopVisibleRowIndex({
  restoreKey,
  topVisibleRowIndex,
  enabled,
  ready,
  rowCount,
  virtualizer,
}: UseRestoreTopVisibleRowIndexInput): void {
  const restoredKeyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!enabled) return
    if (!ready) return
    if (restoredKeyRef.current === restoreKey) return
    if (rowCount <= 0) return
    virtualizer.scrollToIndex(Math.min(topVisibleRowIndex, rowCount - 1), { align: 'start' })
    restoredKeyRef.current = restoreKey
  }, [enabled, ready, restoreKey, rowCount, topVisibleRowIndex, virtualizer])
}
