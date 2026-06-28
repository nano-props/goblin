import { useLayoutEffect, useRef, type RefObject } from 'react'

interface UseRestoreTopVisibleRowIndexInput<T extends HTMLElement> {
  readonly viewportRef: RefObject<T | null>
  readonly restoreKey: string
  readonly topVisibleRowIndex: number
  readonly enabled: boolean
  readonly retrySignal?: unknown
}

export function useRestoreTopVisibleRowIndex<T extends HTMLElement>({
  viewportRef,
  restoreKey,
  topVisibleRowIndex,
  enabled,
  retrySignal,
}: UseRestoreTopVisibleRowIndexInput<T>): void {
  const restoredKeyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!enabled) return
    if (restoredKeyRef.current === restoreKey) return
    const viewport = viewportRef.current
    if (!viewport) return
    if (restoreTopVisibleRowIndex(viewport, topVisibleRowIndex)) {
      restoredKeyRef.current = restoreKey
    }
  }, [enabled, restoreKey, retrySignal, topVisibleRowIndex, viewportRef])

  useLayoutEffect(() => {
    if (!enabled) return
    if (restoredKeyRef.current === restoreKey) return
    if (topVisibleRowIndex <= 0) return
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (restoredKeyRef.current === restoreKey) {
        observer.disconnect()
        return
      }
      if (restoreTopVisibleRowIndex(viewport, topVisibleRowIndex)) {
        restoredKeyRef.current = restoreKey
        observer.disconnect()
      }
    })
    observer.observe(viewport)
    const content = viewport.firstElementChild
    if (content) observer.observe(content)
    return () => observer.disconnect()
  }, [enabled, restoreKey, topVisibleRowIndex, viewportRef])
}

function restoreTopVisibleRowIndex(viewport: HTMLElement, topVisibleRowIndex: number): boolean {
  if (topVisibleRowIndex <= 0) {
    viewport.scrollTop = 0
    return true
  }

  const rowHeight = filetreeRowHeight(viewport)
  if (rowHeight <= 0) return false

  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  if (maxScrollTop <= 0) return false

  viewport.scrollTop = Math.min(topVisibleRowIndex * rowHeight, maxScrollTop)
  return true
}

function filetreeRowHeight(viewport: HTMLElement): number {
  const row = viewport.querySelector<HTMLElement>('[data-filetree-row]')
  return row?.offsetHeight ?? 0
}
