// @vitest-environment jsdom

import { waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { CollapseTransition } from '#/web/components/ui/collapse-transition.tsx'

describe('CollapseTransition', () => {
  test('applies a controlled collapse before the first animation frame', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20)
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => frames.push(callback))
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    try {
      const { rerender, container } = renderInJsdom(
        <CollapseTransition present>
          <div>Collapsible content</div>
        </CollapseTransition>,
      )
      const outer = container.firstElementChild as HTMLDivElement
      expect(outer.style.height).toBe('20px')

      await rerender(
        <CollapseTransition present={false}>
          <div>Collapsible content</div>
        </CollapseTransition>,
      )

      expect(frames).toHaveLength(1)
      expect(outer.style.height).toBe('0px')
      expect(outer.style.opacity).toBe('0')
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  test('applies a controlled expansion before the first animation frame', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20)
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1)
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    try {
      const { rerender, container } = renderInJsdom(
        <CollapseTransition present={false}>
          <div>Collapsible content</div>
        </CollapseTransition>,
      )
      const outer = container.firstElementChild as HTMLDivElement
      expect(outer.style.height).toBe('0px')

      await rerender(
        <CollapseTransition present>
          <div>Collapsible content</div>
        </CollapseTransition>,
      )

      expect(outer.style.height).toBe('20px')
      expect(outer.style.opacity).toBe('1')
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  test('retains children until the collapse transition ends', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20)
    const { rerender, container, queryByText } = renderInJsdom(
      <CollapseTransition present>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    const outer = container.firstElementChild as HTMLDivElement
    await rerender(
      <CollapseTransition present={false}>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    expect(queryByText('Collapsible content')).not.toBeNull()

    await flushTestUpdates(() => {
      outer.dispatchEvent(new Event('transitionend'))
    })

    expect(queryByText('Collapsible content')).toBeNull()
  })

  test('restores height to auto after expanding', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20)
    const { rerender, container, queryByText } = renderInJsdom(
      <CollapseTransition present={false}>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    const outer = container.firstElementChild as HTMLDivElement
    await rerender(
      <CollapseTransition present>
        <div>Collapsible content</div>
      </CollapseTransition>,
    )

    await waitFor(() => {
      expect(queryByText('Collapsible content')).not.toBeNull()
    })

    await flushTestUpdates(() => {
      outer.dispatchEvent(new Event('transitionend'))
    })

    expect(outer.style.height).toBe('auto')
  })
})
