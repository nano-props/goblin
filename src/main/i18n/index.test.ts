import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLocale: vi.fn(() => 'en-US'),
}))

vi.mock('electron', () => ({
  app: {
    getLocale: mocks.getLocale,
  },
}))

describe('main i18n language resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getLocale.mockReturnValue('en-US')
  })

  test('resolves auto language through the shared locale resolver', async () => {
    mocks.getLocale.mockReturnValueOnce('ja-JP')
    const mod = await import('#/main/i18n/index.ts')

    expect(mod.resolveLang('auto')).toBe('ja')
  })

  test('preserves explicit language preferences', async () => {
    const mod = await import('#/main/i18n/index.ts')

    expect(mod.resolveLang('ko')).toBe('ko')
  })
})
