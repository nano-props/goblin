// @vitest-environment jsdom

import { shallowRef } from 'vue'
import { describe, expect, test, vi } from 'vitest'
import { composeRefs } from '#/web/components/ui/refs.ts'

describe('composeRefs', () => {
  test('assigns and clears Vue refs', async () => {
    const node = document.createElement('button')
    const target = shallowRef<HTMLButtonElement | null>(null)
    const assign = composeRefs<HTMLButtonElement>(target)

    assign(node)
    expect(target.value).toBe(node)

    assign(null)
    expect(target.value).toBeNull()
  })

  test('assigns and clears callback refs', async () => {
    const node = document.createElement('button')
    const target = vi.fn()
    const assign = composeRefs<HTMLButtonElement>(target)

    assign(node)
    assign(null)

    expect(target).toHaveBeenNthCalledWith(1, node)
    expect(target).toHaveBeenNthCalledWith(2, null)
  })

  test('updates every ref in a mixed composition', async () => {
    const node = document.createElement('button')
    const objectTarget = shallowRef<HTMLButtonElement | null>(null)
    const callbackTarget = vi.fn()
    const assign = composeRefs<HTMLButtonElement>(objectTarget, callbackTarget)

    assign(node)
    expect(objectTarget.value).toBe(node)
    expect(callbackTarget).toHaveBeenCalledWith(node)

    assign(null)
    expect(objectTarget.value).toBeNull()
    expect(callbackTarget).toHaveBeenCalledWith(null)
  })
})
