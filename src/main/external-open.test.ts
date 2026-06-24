import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcastClientEffectIntent: vi.fn(),
}))

vi.mock('#/main/renderer-surface-events.ts', () => ({
  broadcastClientEffectIntent: mocks.broadcastClientEffectIntent,
}))

describe('external open queue', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('queues safe paths once and drains them in order', async () => {
    const { consumeExternalOpenPaths, enqueueExternalOpenPath } = await import('#/main/external-open.ts')

    expect(enqueueExternalOpenPath('/tmp/repo-a')).toBe(true)
    expect(enqueueExternalOpenPath('/tmp/repo-a')).toBe(false)
    expect(enqueueExternalOpenPath('/tmp/repo-b')).toBe(true)
    expect(enqueueExternalOpenPath('')).toBe(false)

    expect(mocks.broadcastClientEffectIntent).toHaveBeenCalledTimes(2)
    expect(consumeExternalOpenPaths()).toEqual(['/tmp/repo-a', '/tmp/repo-b'])
    expect(consumeExternalOpenPaths()).toEqual([])
  })
})
