// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushMicrotasks, waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'

describe('renderInJsdom', () => {
  test('renders Vue VNodes and returns the standard testing-library query API', async () => {
    const { getByTestId } = renderInJsdom(
      <div>
        <span data-testid="target">hello</span>
      </div>,
    )
    expect(getByTestId('target').textContent).toBe('hello')
  })

  test('rerenders VNodes only when the caller creates a new projection', async () => {
    const initial = <span data-testid="target">before</span>
    const view = renderInJsdom(initial)

    await expect(view.rerender(initial)).rejects.toThrow('newly created VNode')
    await view.rerender(<span data-testid="target">after</span>)

    expect(view.getByTestId('target').textContent).toBe('after')
  })

  test('rejects wrappers for component renders instead of silently ignoring them', () => {
    const Component = defineComponent({
      name: 'ComponentRenderProbe',
      setup() {
        return () => <span>probe</span>
      },
    })
    const Wrapper = defineComponent({
      name: 'ComponentRenderWrapper',
      setup(_props, { slots }) {
        return () => <div>{slots.default?.()}</div>
      },
    })

    expect(() => {
      // @ts-expect-error Component renders intentionally exclude the VNode-only wrapper option.
      renderInJsdom(Component, { wrapper: Wrapper })
    }).toThrow('component renders do not accept wrapper')
  })

  test('flushAnimationFrames awaits the requested number of frames', async () => {
    const { flushAnimationFrames } = renderInJsdom(<div />)
    const cb = vi.fn()
    requestAnimationFrame(cb)
    await flushAnimationFrames(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('flushMicrotasks', () => {
  test('drains the requested number of microtask rounds', async () => {
    const order: string[] = []
    queueMicrotask(() => order.push('a'))
    Promise.resolve().then(() => order.push('b'))
    Promise.resolve().then(() => {
      order.push('c')
      Promise.resolve().then(() => order.push('d'))
    })
    await flushMicrotasks(3)
    expect(order).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('waitForNextMacrotask', () => {
  test('crosses one real timer boundary', async () => {
    let settled = false
    setTimeout(() => {
      settled = true
    }, 0)

    expect(settled).toBe(false)
    await waitForNextMacrotask()
    expect(settled).toBe(true)
  })
})

describe('useFakeTimers', () => {
  test('fakes the standard timer surface', () => {
    useFakeTimers()
    expect(vi.isFakeTimers()).toBe(true)
  })

  test('advanceTimersAndFlush fires pending callbacks and drains microtasks', async () => {
    useFakeTimers()
    const order: string[] = []
    setTimeout(() => {
      order.push('timer')
      Promise.resolve().then(() => order.push('after-timer'))
    }, 100)
    await advanceTimersAndFlush(100)
    expect(order).toEqual(['timer', 'after-timer'])
  })
})
