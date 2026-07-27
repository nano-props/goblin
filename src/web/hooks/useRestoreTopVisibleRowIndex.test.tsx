// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRestoreTopVisibleRowIndex } from '#/web/hooks/useRestoreTopVisibleRowIndex.ts'

describe('useRestoreTopVisibleRowIndex', () => {
  test('restores the saved row index through the virtualizer when ready', () => {
    const scrollToIndex = vi.fn()

    renderInJsdom(
      <ScrollRestoreHarness
        topVisibleRowIndex={6}
        restoreKey="scope-a"
        enabled
        ready
        rowCount={20}
        scrollToIndex={scrollToIndex}
      />,
    )

    expect(scrollToIndex).toHaveBeenCalledWith(6, { align: 'start' })
  })

  test('waits until lazy file tree restore is ready', () => {
    const scrollToIndex = vi.fn()

    const { rerender } = renderInJsdom(
      <ScrollRestoreHarness
        topVisibleRowIndex={6}
        restoreKey="scope-a"
        enabled
        ready={false}
        rowCount={20}
        scrollToIndex={scrollToIndex}
      />,
    )
    expect(scrollToIndex).not.toHaveBeenCalled()

    rerender(
      <ScrollRestoreHarness
        topVisibleRowIndex={6}
        restoreKey="scope-a"
        enabled
        ready
        rowCount={20}
        scrollToIndex={scrollToIndex}
      />,
    )

    expect(scrollToIndex).toHaveBeenCalledWith(6, { align: 'start' })
  })

  test('clamps to the last available row after restore is ready', () => {
    const scrollToIndex = vi.fn()

    renderInJsdom(
      <ScrollRestoreHarness
        topVisibleRowIndex={20}
        restoreKey="scope-a"
        enabled
        ready
        rowCount={5}
        scrollToIndex={scrollToIndex}
      />,
    )

    expect(scrollToIndex).toHaveBeenCalledWith(4, { align: 'start' })
  })

  test('restores only once for the same restore key', () => {
    const scrollToIndex = vi.fn()

    const { rerender } = renderInJsdom(
      <ScrollRestoreHarness
        topVisibleRowIndex={6}
        restoreKey="scope-a"
        enabled
        ready
        rowCount={20}
        scrollToIndex={scrollToIndex}
      />,
    )
    rerender(
      <ScrollRestoreHarness
        topVisibleRowIndex={6}
        restoreKey="scope-a"
        enabled
        ready
        rowCount={25}
        scrollToIndex={scrollToIndex}
      />,
    )

    expect(scrollToIndex).toHaveBeenCalledTimes(1)
  })
})

function ScrollRestoreHarness({
  topVisibleRowIndex,
  restoreKey,
  enabled,
  ready,
  rowCount,
  scrollToIndex,
}: {
  readonly topVisibleRowIndex: number
  readonly restoreKey: string
  readonly enabled: boolean
  readonly ready: boolean
  readonly rowCount: number
  readonly scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end' | 'auto' }) => void
}) {
  useRestoreTopVisibleRowIndex({
    restoreKey,
    topVisibleRowIndex,
    enabled,
    ready,
    rowCount,
    virtualizer: { scrollToIndex },
  })
  return null
}
