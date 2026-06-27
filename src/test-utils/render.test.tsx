// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { advanceTimersAndFlush, flushMicrotasks, renderInJsdom } from '#/test-utils/index.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'

describe('renderInJsdom', () => {
  test('renders React elements and returns the standard RTL query API', () => {
    const { getByTestId } = renderInJsdom(
      <div>
        <span data-testid="target">hello</span>
      </div>,
    )
    expect(getByTestId('target').textContent).toBe('hello')
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
