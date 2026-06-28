// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'

const RETAIN_MS = 240

interface HarnessProps {
  value: string | null
  active: boolean
  resetKey?: string
  onRender: (value: string | null) => void
}

describe('useRetainedValueDuringExit', () => {
  test('keeps the last active value available on the first exiting render', () => {
    vi.useFakeTimers()
    try {
      const renders: Array<string | null> = []
      const { container, rerender } = renderInJsdom(
        <Harness value="feature/a" active onRender={(value) => renders.push(value)} />,
      )

      expect(retainedValue(container)).toBe('feature/a')
      renders.length = 0

      rerender(<Harness value={null} active={false} onRender={(value) => renders.push(value)} />)

      expect(renders[0]).toBe('feature/a')
      expect(retainedValue(container)).toBe('feature/a')

      act(() => {
        vi.advanceTimersByTime(RETAIN_MS - 1)
      })

      expect(retainedValue(container)).toBe('feature/a')

      act(() => {
        vi.advanceTimersByTime(1)
      })

      expect(retainedValue(container)).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not retain a value across reset keys', () => {
    vi.useFakeTimers()
    try {
      const renders: Array<string | null> = []
      const { container, rerender } = renderInJsdom(
        <Harness value="feature/a" active resetKey="repo-a" onRender={(value) => renders.push(value)} />,
      )

      expect(retainedValue(container)).toBe('feature/a')
      renders.length = 0

      rerender(<Harness value={null} active={false} resetKey="repo-b" onRender={(value) => renders.push(value)} />)

      expect(renders[0]).toBeNull()
      expect(retainedValue(container)).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps a re-entered value after an earlier exit timer settles', () => {
    vi.useFakeTimers()
    try {
      const { container, rerender } = renderInJsdom(<Harness value="feature/a" active onRender={() => {}} />)

      rerender(<Harness value={null} active={false} onRender={() => {}} />)
      expect(retainedValue(container)).toBe('feature/a')

      rerender(<Harness value="feature/b" active onRender={() => {}} />)
      expect(retainedValue(container)).toBe('feature/b')

      act(() => {
        vi.advanceTimersByTime(RETAIN_MS)
      })

      expect(retainedValue(container)).toBe('feature/b')

      rerender(<Harness value={null} active={false} onRender={() => {}} />)
      expect(retainedValue(container)).toBe('feature/b')
    } finally {
      vi.useRealTimers()
    }
  })
})

function Harness({ value, active, resetKey, onRender }: HarnessProps) {
  const retainedValue = useRetainedValueDuringExit({ value, active, retainMs: RETAIN_MS, resetKey })
  onRender(retainedValue)
  return <div data-testid="retained-value" data-retained-value={retainedValue ?? ''} />
}

function retainedValue(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLElement>('[data-testid="retained-value"]')?.dataset.retainedValue
}
