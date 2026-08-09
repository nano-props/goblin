// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import type { PropType } from 'vue'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRestoreTopVisibleRowIndex } from '#/web/hooks/useRestoreTopVisibleRowIndex.ts'

type ScrollToIndex = (index: number, options?: { align?: 'start' | 'center' | 'end' | 'auto' }) => void

const ScrollRestoreHarness = defineComponent<{
  topVisibleRowIndex: number
  restoreKey: string
  enabled: boolean
  ready: boolean
  rowCount: number
  showScrollElement: boolean
  scrollToIndex: ScrollToIndex
}>({
  props: {
    topVisibleRowIndex: { type: Number, required: true },
    restoreKey: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    ready: { type: Boolean, required: true },
    rowCount: { type: Number, required: true },
    showScrollElement: { type: Boolean, required: true },
    scrollToIndex: { type: Function as PropType<ScrollToIndex>, required: true },
  },

  setup(props) {
    const scrollElement = ref<HTMLElement | null>(null)
    useRestoreTopVisibleRowIndex({
      restoreKey: () => props.restoreKey,
      topVisibleRowIndex: () => props.topVisibleRowIndex,
      enabled: () => props.enabled,
      ready: () => props.ready,
      rowCount: () => props.rowCount,
      scrollElement,
      virtualizer: () => ({ scrollToIndex: props.scrollToIndex }),
    })
    return () => (props.showScrollElement ? <div ref={scrollElement} /> : null)
  },
})

function harnessProps(
  scrollToIndex: ScrollToIndex,
  overrides: Partial<{
    topVisibleRowIndex: number
    restoreKey: string
    enabled: boolean
    ready: boolean
    rowCount: number
    showScrollElement: boolean
  }> = {},
) {
  return {
    topVisibleRowIndex: 6,
    restoreKey: 'scope-a',
    enabled: true,
    ready: true,
    rowCount: 20,
    showScrollElement: true,
    scrollToIndex,
    ...overrides,
  }
}

describe('useRestoreTopVisibleRowIndex', () => {
  test('restores the saved row index through the virtualizer when ready', async () => {
    const scrollToIndex = vi.fn()
    renderInJsdom(ScrollRestoreHarness, { props: harnessProps(scrollToIndex) })
    await nextTick()
    expect(scrollToIndex).toHaveBeenCalledWith(6, { align: 'start' })
  })

  test('waits until lazy file tree restore is ready', async () => {
    const scrollToIndex = vi.fn()
    const view = renderInJsdom(ScrollRestoreHarness, {
      props: harnessProps(scrollToIndex, { ready: false }),
    })
    expect(scrollToIndex).not.toHaveBeenCalled()

    await view.rerender(harnessProps(scrollToIndex, { ready: true }))
    expect(scrollToIndex).toHaveBeenCalledWith(6, { align: 'start' })
  })

  test('clamps to the last available row', async () => {
    const scrollToIndex = vi.fn()
    renderInJsdom(ScrollRestoreHarness, {
      props: harnessProps(scrollToIndex, { topVisibleRowIndex: 20, rowCount: 5 }),
    })
    await nextTick()
    expect(scrollToIndex).toHaveBeenCalledWith(4, { align: 'start' })
  })

  test('restores only once for the same restore key', async () => {
    const scrollToIndex = vi.fn()
    const view = renderInJsdom(ScrollRestoreHarness, { props: harnessProps(scrollToIndex) })
    await nextTick()
    await view.rerender(harnessProps(scrollToIndex, { rowCount: 25 }))
    expect(scrollToIndex).toHaveBeenCalledOnce()
  })

  test('waits for the scroll element before committing the restore key', async () => {
    const scrollToIndex = vi.fn()
    const view = renderInJsdom(ScrollRestoreHarness, {
      props: harnessProps(scrollToIndex, { showScrollElement: false }),
    })
    await nextTick()
    expect(scrollToIndex).not.toHaveBeenCalled()

    await view.rerender(harnessProps(scrollToIndex, { showScrollElement: true }))
    expect(scrollToIndex).toHaveBeenCalledWith(6, { align: 'start' })
  })
})
