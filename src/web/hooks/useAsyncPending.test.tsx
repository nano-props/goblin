// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'

describe('useAsyncPending', () => {
  test('runs synchronous actions without entering pending state', async () => {
    const onRun = vi.fn()
    const { result } = renderComposableInJsdom(() => useAsyncPending<string>())

    result.value.run('sync', onRun)

    expect(onRun).toHaveBeenCalledOnce()
    expect(result.value.hasPending()).toBe(false)
  })

  test('a changed reset key supersedes older pending work', async () => {
    const resetKey = ref<string | undefined>('a')
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const { result } = renderComposableInJsdom(() => useAsyncPending<string>({ resetKey }))

    void result.value.run('first', () => first.promise)
    expect(result.value.pending.value).toBe('first')

    resetKey.value = 'b'
    await nextTick()
    expect(result.value.pending.value).toBeNull()
    expect(result.value.hasPending()).toBe(false)

    void result.value.run('second', () => second.promise)
    expect(result.value.pending.value).toBe('second')

    first.resolve()
    await first.promise
    expect(result.value.pending.value).toBe('second')

    second.resolve()
    await second.promise
    expect(result.value.pending.value).toBeNull()
  })
})
