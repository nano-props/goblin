// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CopyButton } from '#/web/components/CopyButton.tsx'

describe('CopyButton', () => {
  let container: HTMLDivElement
  let root: Root
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  function render(value: string) {
    act(() => {
      root.render(<CopyButton value={value} copyLabel="Copy" copiedLabel="Copied" />)
    })
  }

  test('does not show copied feedback for a stale clipboard write after value changes', async () => {
    let resolveFirst!: () => void
    writeText.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirst = resolve
      }),
    )

    render('first')
    container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!.click()

    render('second')

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
