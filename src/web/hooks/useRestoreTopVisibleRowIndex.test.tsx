// @vitest-environment jsdom

import { act, useRef, type ReactNode } from 'react'
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
  test('restores immediately from row index when the viewport has a scroll range', () => {
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    const offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20)

    render(<ScrollRestoreHarness topVisibleRowIndex={6} restoreKey="scope-a" enabled />)

    expect(viewport().scrollTop).toBe(120)

    scrollHeightSpy.mockRestore()
    clientHeightSpy.mockRestore()
    offsetHeightSpy.mockRestore()
  })

  test('waits for resize when the viewport is not scrollable yet', () => {
    let resizeCallback: ResizeObserverCallback | null = null
    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200)
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    const offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20)

    render(<ScrollRestoreHarness topVisibleRowIndex={6} restoreKey="scope-a" enabled />)
    expect(viewport().scrollTop).toBe(0)

    scrollHeightSpy.mockReturnValue(1000)
    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    expect(viewport().scrollTop).toBe(120)

    scrollHeightSpy.mockRestore()
    clientHeightSpy.mockRestore()
    offsetHeightSpy.mockRestore()
    globalThis.ResizeObserver = originalResizeObserver
  })

  test('does not restore until enabled', () => {
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    const offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20)

    render(<ScrollRestoreHarness topVisibleRowIndex={6} restoreKey="scope-a" enabled={false} />)
    expect(viewport().scrollTop).toBe(0)

    act(() => {
      root?.render(<ScrollRestoreHarness topVisibleRowIndex={6} restoreKey="scope-a" enabled />)
    })

    expect(viewport().scrollTop).toBe(120)

    scrollHeightSpy.mockRestore()
    clientHeightSpy.mockRestore()
    offsetHeightSpy.mockRestore()
  })
})

function ScrollRestoreHarness({
  topVisibleRowIndex,
  restoreKey,
  enabled,
  retrySignal,
}: {
  readonly topVisibleRowIndex: number
  readonly restoreKey: string
  readonly enabled: boolean
  readonly retrySignal?: unknown
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  useRestoreTopVisibleRowIndex({ viewportRef, restoreKey, topVisibleRowIndex, enabled, retrySignal })
  return (
    <div ref={viewportRef} data-scroll-viewport="">
      <div data-filetree-row="">row</div>
    </div>
  )
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function viewport(): HTMLDivElement {
  const element = container?.querySelector<HTMLDivElement>('[data-scroll-viewport]')
  if (!element) throw new Error('no viewport')
  return element
}
