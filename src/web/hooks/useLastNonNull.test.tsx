// @vitest-environment jsdom

// Unit test for `useLastNonNull`. jsdom cannot verify the close-
// animation retention at the host level because Radix's `Presence`
// unmounts immediately when no CSS animation is found; the host-
// level retention is verified by code review (the host's display JSX
// reads from `*Display`, not from the raw slot). This test covers
// the underlying retention mechanism directly.

import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'

interface HarnessHandle<T> {
  current: T | null
  setProps: (next: { value: T | null }) => void
}

function mountHarness<T>(initial: T | null): HarnessHandle<T> {
  const handle: HarnessHandle<T> = {
    current: initial,
    setProps: () => {},
  }
  function Harness({ value }: { value: T | null }) {
    handle.current = useLastNonNull(value)
    return null
  }
  const result = renderInJsdom(<Harness value={initial} />)
  handle.setProps = (next) => {
    result.rerender(<Harness value={next.value} />)
  }
  return handle
}

describe('useLastNonNull', () => {
  test('returns the current value when it is non-null', () => {
    const handle = mountHarness<string>('hello')
    expect(handle.current).toBe('hello')
  })

  test('returns null when the value has always been null', () => {
    const handle = mountHarness<string>(null)
    expect(handle.current).toBeNull()
  })

  test('regression: returns the last non-null value when the current value becomes null', () => {
    // The bug: the branch action dialog's inner content (title, body,
    // checkboxes) collapsed to empty during the close animation because
    // the store cleared the slot on close and the host read
    // `slot ?? ''`. With `useLastNonNull`, the host keeps rendering the
    // last non-null entry until the next one replaces it.
    const handle = mountHarness<{ branch: string }>({ branch: 'feature/x' })
    expect(handle.current).toEqual({ branch: 'feature/x' })

    // Simulate the store clearing the slot on close. The hook must
    // keep returning the last non-null value, not null.
    handle.setProps({ value: null })
    expect(handle.current).toEqual({ branch: 'feature/x' })

    // A second close → open cycle: the new value replaces the cached one.
    handle.setProps({ value: { branch: 'feature/y' } })
    expect(handle.current).toEqual({ branch: 'feature/y' })

    // Closing again retains the new value.
    handle.setProps({ value: null })
    expect(handle.current).toEqual({ branch: 'feature/y' })
  })
})
