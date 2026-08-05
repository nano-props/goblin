// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { installTerminalComposerViewport } from '#/web/components/terminal/terminal-composer-viewport.ts'

describe('terminal Composer viewport lifecycle', () => {
  test('observes the active container and releases viewport resources when disposed', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    const observerState: { callback: ResizeObserverCallback | null } = { callback: null }
    const resizeObserver = vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function TestResizeObserver(
      callback: ResizeObserverCallback,
    ): ResizeObserver {
      observerState.callback = callback
      return { observe, disconnect, unobserve: vi.fn() }
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
    let containerBottom = 800
    const rect = vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: containerBottom,
      height: 800,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    const viewport = installTerminalComposerViewport({
      container,
      visualViewport,
    })

    try {
      input.focus()
      viewport.activate(input)

      const resizeListener = addViewportListener.mock.calls.find(([type]) => type === 'resize')?.[1]
      const viewportScrollListener = addViewportListener.mock.calls.find(([type]) => type === 'scroll')?.[1]
      const windowScrollListener = addWindowListener.mock.calls.find(([type]) => type === 'scroll')?.[1]
      if (!resizeListener || !viewportScrollListener || !windowScrollListener || !observerState.callback) {
        throw new Error('expected active viewport resources')
      }
      expect(observe).toHaveBeenCalledWith(container)
      expect(container.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-300px)')

      containerBottom = 700
      rect.mockClear()
      observerState.callback([], {} as ResizeObserver)
      expect(rect).toHaveBeenCalledOnce()
      expect(container.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-200px)')

      rect.mockClear()
      viewport.dispose()

      expect(removeViewportListener).toHaveBeenCalledWith('resize', resizeListener)
      expect(removeViewportListener).toHaveBeenCalledWith('scroll', viewportScrollListener)
      expect(removeWindowListener).toHaveBeenCalledWith('scroll', windowScrollListener, true)
      expect(disconnect).toHaveBeenCalledOnce()
      observerState.callback([], {} as ResizeObserver)
      expect(rect).not.toHaveBeenCalled()
      expect(container.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')
    } finally {
      viewport.dispose()
      container.remove()
      resizeObserver.mockRestore()
    }
  })
})
