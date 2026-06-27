// @vitest-environment jsdom

import { act } from 'react'
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
    let resolveFirst!: () => void
    writeText.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirst = resolve
      }),
    )

    const { container, rerender } = renderInJsdom(
      <CopyButton value="first" copyLabel="Copy" copiedLabel="Copied" />,
    )
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!.click()
    })

    rerender(<CopyButton value="second" copyLabel="Copy" copiedLabel="Copied" />)

    await act(async () => {
      resolveFirst()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith('first')
    expect(container.querySelector('button[aria-label="Copied"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Copy"]')).not.toBeNull()
  })
})
