// @vitest-environment jsdom

import { expect, test, vi } from 'vitest'
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

function synchronizedTerminalInput() {
  const element = document.createElement('div')
  const textarea = document.createElement('textarea')
  textarea.style.left = '100px'
  textarea.style.top = '680px'
  textarea.style.height = '20px'
  element.appendChild(textarea)
  document.body.appendChild(element)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 800))
  vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue(rect(100, 680, 10, 20))
  textarea.scrollIntoView = vi.fn()
  return { element, textarea }
}

async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

test('reveals a synchronized focused cursor once when the keyboard obscures it', async () => {
  const visualViewport = viewport(800)
  const { element, textarea } = synchronizedTerminalInput()
  textarea.style.scrollMarginBlockEnd = '5px'
  const reveal = installTerminalViewportReveal({ element, textarea, visualViewport, getLineHeight: () => 14 })

  textarea.focus()
  await nextFrame()
  expect(textarea.scrollIntoView).not.toHaveBeenCalled()

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(textarea.scrollIntoView).toHaveBeenCalledOnce()
  expect(textarea.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  expect(textarea.style.scrollMarginBlockEnd).toBe('42px')

  visualViewport.dispatchEvent(new Event('scroll'))
  await nextFrame()
  expect(textarea.scrollIntoView).toHaveBeenCalledOnce()
  reveal.dispose()
  expect(textarea.style.scrollMarginBlockEnd).toBe('5px')
})

test('rearms the reveal when an already focused terminal is pressed again', async () => {
  const visualViewport = viewport(500)
  const { element, textarea } = synchronizedTerminalInput()
  const reveal = installTerminalViewportReveal({ element, textarea, visualViewport, getLineHeight: () => 14 })

  textarea.focus()
  await nextFrame()
  expect(textarea.scrollIntoView).toHaveBeenCalledOnce()

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 800 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await nextFrame()
  expect(textarea.scrollIntoView).toHaveBeenCalledOnce()

  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(textarea.scrollIntoView).toHaveBeenCalledTimes(2)
  reveal.dispose()
})

test('reveals footer rows when the cursor itself is already visible', async () => {
  const visualViewport = viewport(500)
  const { element, textarea } = synchronizedTerminalInput()
  vi.mocked(textarea.getBoundingClientRect).mockReturnValue(rect(100, 460, 10, 20))
  const reveal = installTerminalViewportReveal({ element, textarea, visualViewport, getLineHeight: () => 14 })

  textarea.focus()
  await nextFrame()

  expect(textarea.scrollIntoView).toHaveBeenCalledOnce()
  expect(textarea.style.scrollMarginBlockEnd).toBe('42px')
  reveal.dispose()
})

test('does not reveal on an unobscured viewport or before xterm synchronizes the textarea', async () => {
  const visualViewport = viewport(800)
  const { element, textarea } = synchronizedTerminalInput()
  const reveal = installTerminalViewportReveal({ element, textarea, visualViewport, getLineHeight: () => 14 })

  textarea.focus()
  await nextFrame()
  expect(textarea.scrollIntoView).not.toHaveBeenCalled()

  textarea.style.left = ''
  Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
  visualViewport.dispatchEvent(new Event('resize'))
  await nextFrame()
  expect(textarea.scrollIntoView).not.toHaveBeenCalled()

  reveal.dispose()
  textarea.style.left = '100px'
  visualViewport.dispatchEvent(new Event('scroll'))
  await nextFrame()
  expect(textarea.scrollIntoView).not.toHaveBeenCalled()
})
