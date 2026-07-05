// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { CollapseTransition } from '#/web/components/ui/collapse-transition.tsx'

describe('CollapseTransition', () => {
  test('retains children until the collapse transition ends', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20)
    const { rerender, container } = render(
      <CollapseTransition present>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    const outer = container.firstElementChild as HTMLDivElement
    rerender(
      <CollapseTransition present={false}>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    expect(screen.queryByText('Collapsible content')).not.toBeNull()

    act(() => {
      outer.dispatchEvent(new Event('transitionend'))
    })

    expect(screen.queryByText('Collapsible content')).toBeNull()
  })

  test('restores height to auto after expanding', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20)
    const { rerender, container } = render(
      <CollapseTransition present={false}>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    const outer = container.firstElementChild as HTMLDivElement
    rerender(
      <CollapseTransition present>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    await waitFor(() => {
      expect(screen.queryByText('Collapsible content')).not.toBeNull()
    })

    act(() => {
      outer.dispatchEvent(new Event('transitionend'))
    })

    expect(outer.style.height).toBe('auto')
  })
})
