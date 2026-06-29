// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useRestoreTopVisibleRowIndex } from '#/web/hooks/useRestoreTopVisibleRowIndex.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('useRestoreTopVisibleRowIndex', () => {
  test('restores the saved row index through the virtualizer when ready', () => {
    const scrollToIndex = vi.fn()

    render(
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

    render(
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

    act(() => {
      root?.render(
        <ScrollRestoreHarness
          topVisibleRowIndex={6}
          restoreKey="scope-a"
          enabled
          ready
          rowCount={20}
          scrollToIndex={scrollToIndex}
        />,
      )
    })

    expect(scrollToIndex).toHaveBeenCalledWith(6, { align: 'start' })
  })

  test('clamps to the last available row after restore is ready', () => {
    const scrollToIndex = vi.fn()

    render(
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

    render(
      <ScrollRestoreHarness
        topVisibleRowIndex={6}
        restoreKey="scope-a"
        enabled
        ready
        rowCount={20}
        scrollToIndex={scrollToIndex}
      />,
    )
    act(() => {
      root?.render(
        <ScrollRestoreHarness
          topVisibleRowIndex={6}
          restoreKey="scope-a"
          enabled
          ready
          rowCount={25}
          scrollToIndex={scrollToIndex}
        />,
      )
    })

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

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}
