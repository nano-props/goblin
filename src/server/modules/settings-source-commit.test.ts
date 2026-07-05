import { afterEach, expect, test, vi } from 'vitest'

const persistence = vi.hoisted(() => ({
  stored: null as unknown,
  failNextWrite: false,
  readUserSettingsJson: vi.fn(async () => persistence.stored),
  writeUserSettingsJson: vi.fn(async (data: unknown) => {
    if (persistence.failNextWrite) {
      persistence.failNextWrite = false
      throw new Error('disk full')
    }
    persistence.stored = structuredClone(data)
  }),
  resetUserSettingsPersistenceForTests: vi.fn(),
}))

vi.mock('#/server/modules/settings-persistence.ts', () => persistence)

afterEach(async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  mod.resetServerSettingsSourceForTests()
  persistence.stored = null
  persistence.failNextWrite = false
  vi.clearAllMocks()
  vi.resetModules()
})

test('does not expose failed settings writes through the in-memory cache', async () => {
  const mod = await import('#/server/modules/settings-source.ts')

  await mod.addServerRecentRepo({ kind: 'local', id: '/repo-a' })
  persistence.failNextWrite = true

  await expect(mod.addServerRecentRepo({ kind: 'local', id: '/repo-b' })).rejects.toThrow('disk full')

  expect(await mod.getServerRecentRepos()).toEqual([{ kind: 'local', id: '/repo-a' }])
  await expect(mod.addServerRecentRepo({ kind: 'local', id: '/repo-c' })).resolves.toEqual([
    { kind: 'local', id: '/repo-c' },
    { kind: 'local', id: '/repo-a' },
  ])
})

test('retries default settings initialization after a transient write failure', async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  persistence.failNextWrite = true

  await expect(mod.getServerFetchIntervalSec()).rejects.toThrow('disk full')
  await expect(mod.getServerFetchIntervalSec()).resolves.toBe(120)
})
