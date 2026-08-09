// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'

const RETAIN_MS = 240

const Harness = defineComponent<{ value: string | null; active: boolean; resetKey?: string }>({
  props: ['value', 'active', 'resetKey'],
  setup(props) {
    const retainedValue = useRetainedValueDuringExit({
      value: () => props.value,
      active: () => props.active,
      retainMs: RETAIN_MS,
      resetKey: () => props.resetKey,
    })
    return () => <div data-testid="retained-value" data-retained-value={retainedValue.value ?? ''} />
  },
})

describe('useRetainedValueDuringExit', () => {
  test('retains the last active value until the exit window ends', async () => {
    useFakeTimers()
    const view = renderInJsdom(Harness, { props: { value: 'feature/a', active: true } })

    await view.rerender({ value: null, active: false })
    expect(retainedValue(view.container)).toBe('feature/a')

    vi.advanceTimersByTime(RETAIN_MS - 1)
    await nextTick()
    expect(retainedValue(view.container)).toBe('feature/a')

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(retainedValue(view.container)).toBe('')
  })

  test('does not retain a value across reset keys', async () => {
    useFakeTimers()
    const view = renderInJsdom(Harness, {
      props: { value: 'feature/a', active: true, resetKey: 'repo-a' },
    })

    await view.rerender({ value: null, active: false, resetKey: 'repo-b' })
    expect(retainedValue(view.container)).toBe('')
  })

  test('cancels the old exit timer when the view re-enters', async () => {
    useFakeTimers()
    const view = renderInJsdom(Harness, { props: { value: 'feature/a', active: true } })

    await view.rerender({ value: null, active: false })
    await view.rerender({ value: 'feature/b', active: true })
    vi.advanceTimersByTime(RETAIN_MS)
    await nextTick()

    expect(retainedValue(view.container)).toBe('feature/b')
  })

  test('does not extend the exit window when an inactive value changes', async () => {
    useFakeTimers()
    const view = renderInJsdom(Harness, { props: { value: 'feature/a', active: true } })

    await view.rerender({ value: null, active: false })
    vi.advanceTimersByTime(RETAIN_MS - 40)
    await view.rerender({ value: 'unrelated-projection', active: false })
    vi.advanceTimersByTime(40)
    await nextTick()

    expect(retainedValue(view.container)).toBe('')
  })
})

function retainedValue(container: Element): string | undefined {
  return container.querySelector<HTMLElement>('[data-testid="retained-value"]')?.dataset.retainedValue
}
