// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { defineComponent } from 'vue'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'

describe('useLastNonNull', () => {
  test('keeps the latest non-null value when the source becomes null', async () => {
    const Harness = defineComponent<{ value: { branch: string } | null }>({
      props: ['value'],
      setup(props) {
        const retained = useLastNonNull(() => props.value)
        return () => <div data-testid="value">{retained.value?.branch ?? ''}</div>
      },
    })
    const view = renderInJsdom(Harness, { props: { value: { branch: 'feature/x' } } })

    expect(view.getByTestId('value').textContent).toBe('feature/x')
    await view.rerender({ value: null })
    expect(view.getByTestId('value').textContent).toBe('feature/x')
    await view.rerender({ value: { branch: 'feature/y' } })
    expect(view.getByTestId('value').textContent).toBe('feature/y')
    await view.rerender({ value: null })
    expect(view.getByTestId('value').textContent).toBe('feature/y')
  })

  test('returns null when the source has always been null', async () => {
    const Harness = defineComponent({
      setup() {
        const retained = useLastNonNull<string>(null)
        return () => <div data-testid="value">{retained.value ?? ''}</div>
      },
    })
    const view = renderInJsdom(Harness)
    expect(view.getByTestId('value').textContent).toBe('')
  })
})
