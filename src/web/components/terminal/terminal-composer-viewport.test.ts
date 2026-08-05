// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { installTerminalComposerViewport } from '#/web/components/terminal/terminal-composer-viewport.ts'

describe('terminal Composer viewport lifecycle', () => {
  test('removes active viewport resources when disposed', () => {
    const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
    const disconnect = vi.fn()
    const observerState: { callback: ResizeObserverCallback | null } = { callback: null }
    class TestResizeObserver {
      observe = vi.fn()
      disconnect = disconnect

      constructor(callback: ResizeObserverCallback) {
        observerState.callback = callback
      }
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    })

    const visualViewport = new EventTarget() as VisualViewport
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 500 },
      offsetTop: { configurable: true, value: 0 },
      scale: { configurable: true, value: 1 },
    })
    const container = document.createElement('div')
    const input = document.createElement('textarea')
    container.append(input)
    document.body.append(container)
    const addViewportListener = vi.spyOn(visualViewport, 'addEventListener')
    const removeViewportListener = vi.spyOn(visualViewport, 'removeEventListener')
    const addWindowListener = vi.spyOn(window, 'addEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const rect = vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      bottom: 800,
      height: 800,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const viewport = installTerminalComposerViewport({
      container,
      visualViewport,
    })

    try {
      input.focus()
      viewport.activate(input)

      expect(addViewportListener).toHaveBeenCalledWith('resize', expect.any(Function))
      expect(addViewportListener).toHaveBeenCalledWith('scroll', expect.any(Function))
      expect(addWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
      rect.mockClear()
      observerState.callback?.([], {} as ResizeObserver)
      expect(rect).toHaveBeenCalledOnce()

      rect.mockClear()
      viewport.dispose()

      expect(removeViewportListener).toHaveBeenCalledWith('resize', expect.any(Function))
      expect(removeViewportListener).toHaveBeenCalledWith('scroll', expect.any(Function))
      expect(removeWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
      expect(disconnect).toHaveBeenCalledOnce()
      observerState.callback?.([], {} as ResizeObserver)
      expect(rect).not.toHaveBeenCalled()
    } finally {
      viewport.dispose()
      container.remove()
      if (originalResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver)
      else Reflect.deleteProperty(globalThis, 'ResizeObserver')
    }
  })
})
