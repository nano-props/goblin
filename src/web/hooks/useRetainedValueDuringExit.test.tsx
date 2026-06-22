// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'

const RETAIN_MS = 240

interface HarnessProps {
  value: string | null
  active: boolean
  resetKey?: string
  onRender: (value: string | null) => void
}

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('useRetainedValueDuringExit', () => {
  test('keeps the last active value available on the first exiting render', () => {
    vi.useFakeTimers()
    try {
      const renders: Array<string | null> = []

      render(<Harness value="feature/a" active onRender={(value) => renders.push(value)} />)

      expect(retainedValue()).toBe('feature/a')
      renders.length = 0

      render(<Harness value={null} active={false} onRender={(value) => renders.push(value)} />)

      expect(renders[0]).toBe('feature/a')
      expect(retainedValue()).toBe('feature/a')

      act(() => {
        vi.advanceTimersByTime(RETAIN_MS - 1)
      })

      expect(retainedValue()).toBe('feature/a')

      act(() => {
        vi.advanceTimersByTime(1)
      })

      expect(retainedValue()).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not retain a value across reset keys', () => {
    vi.useFakeTimers()
    try {
      const renders: Array<string | null> = []

      render(<Harness value="feature/a" active resetKey="repo-a" onRender={(value) => renders.push(value)} />)

      expect(retainedValue()).toBe('feature/a')
      renders.length = 0

      render(<Harness value={null} active={false} resetKey="repo-b" onRender={(value) => renders.push(value)} />)

      expect(renders[0]).toBeNull()
      expect(retainedValue()).toBe('')
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

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function retainedValue(): string | undefined {
  return container?.querySelector<HTMLElement>('[data-testid="retained-value"]')?.dataset.retainedValue
}
