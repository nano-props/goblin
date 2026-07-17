import { afterEach, expect, test, vi } from 'vitest'

const REPO_A = 'goblin+file:///repo-a'
const REPO_B = 'goblin+file:///repo-b'
const REPO_C = 'goblin+file:///repo-c'

const persistence = vi.hoisted(() => ({
  stored: null as unknown,
  failNextWrite: false,
  nextWriteGate: null as Promise<void> | null,
  nextWriteStarted: null as (() => void) | null,
  readUserSettingsJson: vi.fn(async () => persistence.stored),
  writeUserSettingsJson: vi.fn(async (data: unknown) => {
    if (persistence.failNextWrite) {
      persistence.failNextWrite = false
      throw new Error('disk full')
    }
    if (persistence.nextWriteGate) {
      const gate = persistence.nextWriteGate
      persistence.nextWriteGate = null
      persistence.nextWriteStarted?.()
      persistence.nextWriteStarted = null
      await gate
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
  persistence.nextWriteGate = null
  persistence.nextWriteStarted = null
  vi.clearAllMocks()
  vi.resetModules()
})

test('rolls back an admitted layout CAS when its runtime epoch closes during the durable write', async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  const repository = mod.serverWorkspacePaneLayoutRepository
  const initial = {
    entries: [{ repoRoot: REPO_A, branchName: 'main', worktreePath: null, tabs: [] }],
  }
  let current = await repository.load(REPO_A)
  await expect(
    repository.compareAndSwap({
      repoRoot: REPO_A,
      expected: current.layout,
      replacement: initial,
    }),
  ).resolves.toMatchObject({ kind: 'accepted' })
  current = await repository.load(REPO_A)

  const writeGate = Promise.withResolvers<void>()
  const writeStarted = Promise.withResolvers<void>()
  persistence.nextWriteGate = writeGate.promise
  persistence.nextWriteStarted = () => writeStarted.resolve()
  let oldRuntimeIsCurrent = true
  const cleanup = repository.compareAndSwap({
    repoRoot: REPO_A,
    expected: current.layout,
    replacement: { entries: [] },
    admit: () => oldRuntimeIsCurrent,
  })
  await writeStarted.promise
  // Models close + reopen while the replacement is in the atomic file write.
  // The old epoch's predicate must not authorize deleting the layout inherited
  // by the new epoch.
  oldRuntimeIsCurrent = false
  writeGate.resolve()

  await expect(cleanup).resolves.toMatchObject({ kind: 'admission-rejected' })
  await expect(repository.load(REPO_A)).resolves.toEqual({ layout: initial })
  expect(persistence.writeUserSettingsJson).toHaveBeenLastCalledWith(
    expect.objectContaining({
      workspace: expect.objectContaining({
        workspacePaneTabsByTargetByWorkspace: expect.objectContaining({ [REPO_A]: expect.any(Object) }),
      }),
    }),
  )
})

test('does not expose failed settings writes through the in-memory cache', async () => {
  const mod = await import('#/server/modules/settings-source.ts')

  await mod.addServerRecentWorkspace({ kind: 'local', id: REPO_A })
  persistence.failNextWrite = true

  await expect(mod.addServerRecentWorkspace({ kind: 'local', id: REPO_B })).rejects.toThrow('disk full')

  expect(await mod.getServerRecentWorkspaces()).toEqual([{ kind: 'local', id: REPO_A }])
  await expect(mod.addServerRecentWorkspace({ kind: 'local', id: REPO_C })).resolves.toEqual([
    { kind: 'local', id: REPO_C },
    { kind: 'local', id: REPO_A },
  ])
})

test('retries default settings initialization after a transient write failure', async () => {
  const mod = await import('#/server/modules/settings-source.ts')
  persistence.failNextWrite = true

  await expect(mod.getServerFetchIntervalSec()).rejects.toThrow('disk full')
  await expect(mod.getServerFetchIntervalSec()).resolves.toBe(120)
})
