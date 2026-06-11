// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FilePathText } from '#/web/components/FilePathText.tsx'
import { ellipsizeLeftPathByWidth } from '#/web/lib/display-path.ts'

class MockResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this)
  }

  unobserve() {}

  disconnect() {}
}

describe('FilePathText', () => {
  const originalResizeObserver = window.ResizeObserver
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    document.body.innerHTML = ''
    window.ResizeObserver = MockResizeObserver
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 112
      },
    })
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        width: 112,
        height: 16,
        top: 0,
        right: 112,
        bottom: 16,
        left: 0,
        x: 0,
        y: 0,
        toJSON() {
          return ''
        },
      }
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    window.ResizeObserver = originalResizeObserver
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      return
    }
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  })

  test('measures actual rendered width instead of estimating by character count', async () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          fontStyle: 'normal',
          fontVariant: 'normal',
          fontWeight: '400',
          fontSize: '16px',
          fontFamily: 'Goblin Mono',
          letterSpacing: '1px',
        }) as CSSStyleDeclaration,
    )

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: measureTextWidth(text) }),
    } as unknown as CanvasRenderingContext2D)

    const path = 'src/example/WideWide/iiiiiiii.ts'
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(<FilePathText path={path} />)
    })

    try {
      const span = container.querySelector('span')
      expect(span).not.toBeNull()
      expect(span?.textContent).toBe(
        ellipsizeLeftPathByWidth(path, 112, (text) => measureTextWidth(text) + Math.max(0, text.length - 1)),
      )
      expect(span?.className).not.toContain('truncate')
      expect(span?.getAttribute('title')).toBe(path)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('recomputes when typography changes without a width change', async () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const isTight = (element as HTMLElement).className.includes('tight')
      return {
        fontStyle: 'normal',
        fontVariant: 'normal',
        fontWeight: '400',
        fontSize: '16px',
        fontFamily: 'Goblin Mono',
        letterSpacing: isTight ? '0px' : '4px',
      } as CSSStyleDeclaration
    })

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as unknown as CanvasRenderingContext2D)

    const path = 'src/example/deeply/nested/file.ts'
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(<FilePathText path={path} className="wide" />)
    })

    try {
      const before = container.querySelector('span')?.textContent
      expect(before).toBe('/file.ts')

      await act(async () => {
        root.render(<FilePathText path={path} className="tight" />)
      })

      const after = container.querySelector('span')?.textContent
      expect(after).toBe(ellipsizeLeftPathByWidth(path, 112, (text) => text.length * 10))
      expect(after).toBe('…/file.ts')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

function measureTextWidth(text: string): number {
  let width = 0
  for (const char of text) {
    if (char === '/') {
      width += 4
      continue
    }
    if (char === 'i') {
      width += 5
      continue
    }
    if (char === 'W') {
      width += 13
      continue
    }
    if (char === '…') {
      width += 9
      continue
    }
    width += 10
  }
  return width
}
