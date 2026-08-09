// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest'
import {
  installTerminalViewportReveal,
  terminalInputRevealRow,
} from '#/web/components/terminal/terminal-viewport-reveal.ts'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function viewport(height: number, offsetTop = 0): VisualViewport {
  const target = new EventTarget()
  Object.defineProperties(target, {
    height: { configurable: true, value: height },
    offsetTop: { configurable: true, value: offsetTop },
  })
  return target as VisualViewport
}

function terminalGeometryEvents() {
  let terminalResizeListener: (() => void) | null = null
  return {
    onTerminalResize: (next: () => void) => {
      terminalResizeListener = next
      return {
        dispose: () => {
          if (terminalResizeListener === next) terminalResizeListener = null
        },
      }
    },
    emitTerminalResize: () => terminalResizeListener?.(),
  }
}

function terminalInput() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  element.appendChild(textarea)
  document.body.appendChild(element)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 800))
  return { element, textarea }
}

function revealMarker(element: HTMLElement): HTMLElement {
  const marker = element.querySelector<HTMLElement>('[aria-hidden="true"]')
  if (!marker) throw new Error('terminal reveal marker was not installed')
  marker.scrollIntoView = vi.fn()
  return marker
}

async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

afterEach(() => {
  document.body.replaceChildren()
})

test('reveals the current focused cursor once when the keyboard obscures the terminal', async () => {
  const visualViewport = viewport(800)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  let cursorRow = 12
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => 14,
    getCursorRow: () => cursorRow,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).not.toHaveBeenCalled()

  cursorRow = 20
  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 300 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
  expect(marker.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  expect(marker.style.top).toBe('280px')
  expect(marker.style.height).toBe('14px')
  expect(marker.style.scrollMarginBlockEnd).toBe('56px')

  visualViewport.dispatchEvent(new Event('scroll'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
  reveal.dispose()
})

test('reveals a cursor above a shifted visual viewport', async () => {
  const visualViewport = viewport(500, 300)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => 14,
    getCursorRow: () => 5,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()

  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
  expect(marker.style.top).toBe('70px')
  reveal.dispose()
})

test('reveals an already focused terminal when pressed before or after the keyboard opens', async () => {
  const visualViewport = viewport(300)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => 14,
    getCursorRow: () => 20,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 800 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 300 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(3)
  reveal.dispose()
})

test('does not poll cursor movement between explicit reveal requests', async () => {
  const visualViewport = viewport(300)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  let cursorRow = 20
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => 14,
    getCursorRow: () => cursorRow,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  cursorRow = 24
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)
  expect(marker.style.top).toBe('336px')

  textarea.blur()
  cursorRow = 25
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)
  reveal.dispose()
})

test('rechecks the focused cursor after terminal geometry changes', async () => {
  const visualViewport = viewport(300)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  let lineHeight = 14
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => lineHeight,
    getCursorRow: () => 20,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  lineHeight = 16
  geometryEvents.emitTerminalResize()
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)
  expect(marker.style.top).toBe('320px')
  reveal.dispose()
})

test('rechecks the focused cursor when the visible viewport shrinks again', async () => {
  const visualViewport = viewport(300)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => 14,
    getCursorRow: () => 20,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 250 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)
  reveal.dispose()
})

test('reveals the bottom-page cursor position while normal scrollback is visible', async () => {
  const visualViewport = viewport(100)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => 14,
    getCursorRow: () => terminalInputRevealRow({ type: 'normal', baseY: 100, cursorY: 5, viewportY: 50 }, 30),
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()

  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
  expect(marker.style.top).toBe('70px')
  expect(marker.style.scrollMarginBlockEnd).toBe('56px')
  reveal.dispose()
})

test('does not project an invalid alternate-buffer cursor into the viewport', () => {
  expect(terminalInputRevealRow({ type: 'alternate', baseY: 100, cursorY: 5, viewportY: 50 }, 30)).toBeNull()
})

test('uses the current viewport row when the cursor is already visible', () => {
  expect(terminalInputRevealRow({ type: 'normal', baseY: 100, cursorY: 5, viewportY: 90 }, 30)).toBe(15)
})

test('waits for a visible cursor row and stops after disposal', async () => {
  const visualViewport = viewport(300)
  const geometryEvents = terminalGeometryEvents()
  const { element, textarea } = terminalInput()
  let cursorRow: number | null = null
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    onTerminalResize: geometryEvents.onTerminalResize,
    getLineHeight: () => 14,
    getCursorRow: () => cursorRow,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).not.toHaveBeenCalled()

  cursorRow = 20
  visualViewport.dispatchEvent(new Event('scroll'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  reveal.dispose()
  expect(marker.isConnected).toBe(false)
  geometryEvents.emitTerminalResize()
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
})
