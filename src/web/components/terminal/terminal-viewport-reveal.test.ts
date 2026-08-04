// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest'
import { installTerminalViewportReveal } from '#/web/components/terminal/terminal-viewport-reveal.ts'

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

function viewport(height: number): VisualViewport {
  const target = new EventTarget()
  Object.defineProperties(target, {
    height: { configurable: true, value: height },
    offsetTop: { configurable: true, value: 0 },
  })
  return target as VisualViewport
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
  const { element, textarea } = terminalInput()
  let cursorRow = 12
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    getLineHeight: () => 14,
    getCursorRow: () => cursorRow,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).not.toHaveBeenCalled()

  cursorRow = 20
  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
  expect(marker.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  expect(marker.style.top).toBe('280px')
  expect(marker.style.height).toBe('14px')
  expect(marker.style.scrollMarginBlockEnd).toBe('42px')

  visualViewport.dispatchEvent(new Event('scroll'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
  reveal.dispose()
})

test('rearms the reveal when an already focused terminal is pressed again', async () => {
  const visualViewport = viewport(500)
  const { element, textarea } = terminalInput()
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    getLineHeight: () => 14,
    getCursorRow: () => 20,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 800 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)
  reveal.dispose()
})

test('delegates nearest reveal with footer space when the terminal is obscured', async () => {
  const visualViewport = viewport(500)
  const { element, textarea } = terminalInput()
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
    getLineHeight: () => 14,
    getCursorRow: () => 5,
  })
  const marker = revealMarker(element)

  textarea.focus()
  await nextFrame()

  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
  expect(marker.style.scrollMarginBlockEnd).toBe('42px')
  reveal.dispose()
})

test('waits for a visible cursor row and stops after disposal', async () => {
  const visualViewport = viewport(500)
  const { element, textarea } = terminalInput()
  let cursorRow: number | null = null
  const reveal = installTerminalViewportReveal({
    element,
    textarea,
    visualViewport,
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
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(marker.scrollIntoView).toHaveBeenCalledOnce()
})
