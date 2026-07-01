// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { composeRefs } from '#/web/components/ui/refs.ts'

describe('composeRefs', () => {
  test('assigns and clears object refs', () => {
    const node = document.createElement('button')
    const ref = { current: null as HTMLButtonElement | null }

    const cleanup = composeRefs<HTMLButtonElement>(ref)(node)

    expect(ref.current).toBe(node)

    cleanup?.()

    expect(ref.current).toBeNull()
  })

  test('preserves legacy callback ref cleanup through null callbacks', () => {
    const node = document.createElement('button')
    const ref = vi.fn()

    const cleanup = composeRefs<HTMLButtonElement>(ref)(node)

    expect(ref).toHaveBeenCalledWith(node)

    cleanup?.()

    expect(ref).toHaveBeenCalledWith(null)
  })

  test('preserves React 19 callback ref cleanup functions', () => {
    const node = document.createElement('button')
    const cleanupRef = vi.fn()
    const ref = vi.fn(() => cleanupRef)

    const cleanup = composeRefs<HTMLButtonElement>(ref)(node)

    expect(ref).toHaveBeenCalledTimes(1)
    expect(ref).toHaveBeenCalledWith(node)

    cleanup?.()

    expect(cleanupRef).toHaveBeenCalledTimes(1)
    expect(ref).not.toHaveBeenCalledWith(null)
  })

  test('cleans mixed refs without dropping any participant', () => {
    const node = document.createElement('button')
    const objectRef = { current: null as HTMLButtonElement | null }
    const legacyRef = vi.fn()
    const cleanupRef = vi.fn()
    const modernRef = vi.fn(() => cleanupRef)

    const cleanup = composeRefs<HTMLButtonElement>(objectRef, legacyRef, modernRef)(node)

    expect(objectRef.current).toBe(node)
    expect(legacyRef).toHaveBeenCalledWith(node)
    expect(modernRef).toHaveBeenCalledWith(node)

    cleanup?.()

    expect(objectRef.current).toBeNull()
    expect(legacyRef).toHaveBeenCalledWith(null)
    expect(cleanupRef).toHaveBeenCalledTimes(1)
  })
})
