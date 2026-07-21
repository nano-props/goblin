import { afterEach, describe, expect, test, vi } from 'vitest'

describe('client page identity', () => {
  afterEach(() => vi.resetModules())

  test('is stable for one loaded page module', async () => {
    const { readClientPageId } = await import('#/web/client-page-id.ts')

    expect(readClientPageId()).toBe(readClientPageId())
    expect(readClientPageId()).toMatch(/^client-/)
  })

  test('is renewed when a new page module instance loads', async () => {
    const first = (await import('#/web/client-page-id.ts')).readClientPageId()
    vi.resetModules()
    const second = (await import('#/web/client-page-id.ts')).readClientPageId()

    expect(second).not.toBe(first)
  })
})
