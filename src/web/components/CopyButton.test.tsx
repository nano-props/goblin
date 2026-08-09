// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CopyButton } from '#/web/components/CopyButton.tsx'
import { renderInJsdom } from '#/test-utils/render.tsx'

describe('CopyButton', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('does not show copied feedback for a stale clipboard write after value changes', async () => {
    const firstWrite = Promise.withResolvers<void>()
    writeText.mockReturnValueOnce(firstWrite.promise)

    const { container, rerender } = renderInJsdom(<CopyButton value="first" copyLabel="Copy" copiedLabel="Copied" />)
    await flushTestUpdates(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!.click()
    })

    await rerender(<CopyButton value="second" copyLabel="Copy" copiedLabel="Copied" />)

    await flushTestUpdates(async () => {
      firstWrite.resolve()
      await firstWrite.promise
    })

    expect(writeText).toHaveBeenCalledWith('first')
    expect(container.querySelector('button[aria-label="Copied"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Copy"]')).not.toBeNull()
  })
})
