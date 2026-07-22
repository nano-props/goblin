import { afterEach, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const REPO_A = workspaceIdForTest('goblin+file:///repo-a')
const REPO_B = workspaceIdForTest('goblin+file:///repo-b')
const REPO_C = workspaceIdForTest('goblin+file:///repo-c')

const persistence = vi.hoisted(() => ({
  stored: null as unknown,
  failNextWrite: false,
  readUserSettingsJson: vi.fn(async () =>
    persistence.stored === null
      ? { kind: 'missing' as const }
      : { kind: 'loaded' as const, value: persistence.stored },
  ),
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

test('commits a layout CAS with one durable write', async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  const repository = mod.serverWorkspacePaneLayoutRepository
  const current = await repository.load(REPO_A)
  const writesBefore = persistence.writeUserSettingsJson.mock.calls.length

  await expect(
    repository.compareAndSwap({
      workspaceId: REPO_A,
      expected: current.layout,
      replacement: {
        entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [] }],
      },
    }),
  ).resolves.toMatchObject({ kind: 'accepted' })

  expect(persistence.writeUserSettingsJson).toHaveBeenCalledTimes(writesBefore + 1)
})

test('does not expose failed settings writes through the in-memory cache', async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  await mod.addServerRecentWorkspace({ id: REPO_A })
  persistence.failNextWrite = true
  await expect(mod.addServerRecentWorkspace({ id: REPO_B })).rejects.toThrow('disk full')
  expect(await mod.getServerRecentWorkspaces()).toEqual([{ id: REPO_A }])
  await expect(mod.addServerRecentWorkspace({ id: REPO_C })).resolves.toEqual([
    { id: REPO_C },
    { id: REPO_A },
  ])
})

test('retries default settings initialization after a transient write failure', async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  persistence.failNextWrite = true
  await expect(mod.getServerFetchIntervalSec()).rejects.toThrow('disk full')
  await expect(mod.getServerFetchIntervalSec()).resolves.toBe(120)
})

test('replaces invalid persisted settings with defaults', async () => {
  persistence.stored = { theme: 'bogus' }
  const mod = await import('#/server/modules/settings-source.ts')

  await expect(mod.getUserSettings()).resolves.toMatchObject({ theme: 'auto', fetchIntervalSec: 120 })
  expect(persistence.writeUserSettingsJson).toHaveBeenCalledTimes(1)
  expect(persistence.stored).toMatchObject({ theme: 'auto', fetchIntervalSec: 120 })
  expect(persistence.stored).not.toHaveProperty('version')
})
