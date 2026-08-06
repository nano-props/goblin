// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { copyToClipboard } from '#/web/clipboard/clipboard-copy.ts'

describe('copyToClipboard', () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')

  afterEach(() => {
    vi.restoreAllMocks()
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor)
    else Reflect.deleteProperty(document, 'execCommand')
  })

  test('uses the Clipboard API when the browser exposes it', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    await copyToClipboard('patch text')

    expect(writeText).toHaveBeenCalledWith('patch text')
  })

  test('copies through the document command when an HTTP LAN context omits the Clipboard API', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')
    let copiedValue = ''
    const execCommand = vi.fn(() => {
      copiedValue = document.getSelection()?.toString() ?? ''
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await copyToClipboard('LAN copy text')

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(copiedValue).toBe('LAN copy text')
    expect(document.querySelector('span[style*="user-select"]')).toBeNull()
  })

  test('fails when neither clipboard path succeeds', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('Clipboard permission denied'))) },
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })

    await expect(copyToClipboard('text')).rejects.toMatchObject({ name: 'NotAllowedError' })
  })
})
