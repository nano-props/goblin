import { afterEach, describe, expect, test, vi } from 'vitest'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { restorableWorkspacePaneTargetKey } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const REPO_A = workspaceIdForTest('goblin+file:///repo-a')
const REPO_B = workspaceIdForTest('goblin+file:///repo-b')
const REPO_C = workspaceIdForTest('goblin+file:///repo-c')

const persistence = vi.hoisted(() => ({
  SettingsPersistenceWriteError: class SettingsPersistenceWriteError extends Error {},
  stored: null as unknown,
  failNextWrite: false,
  writeBarrier: null as { started: () => void; resume: Promise<void> } | null,
  readUserSettingsJson: vi.fn(async () =>
    persistence.stored === null ? { kind: 'missing' as const } : { kind: 'loaded' as const, value: persistence.stored },
  ),
  writeUserSettingsJson: vi.fn(async (data: unknown) => {
    const barrier = persistence.writeBarrier
    if (barrier) {
      persistence.writeBarrier = null
      barrier.started()
      await barrier.resume
    }
    if (persistence.failNextWrite) {
      persistence.failNextWrite = false
      throw new Error('disk full')
    }
    persistence.stored = structuredClone(data)
  }),
  resetUserSettingsPersistenceForTests: vi.fn(),
}))

vi.mock('#/server/modules/settings-persistence.ts', () => persistence)

describe('settings source commits', () => {
  afterEach(async () => {
    const mod = await import('#/server/modules/settings-source.ts')
    mod.resetServerSettingsSourceForTests()
    persistence.stored = null
    persistence.failNextWrite = false
    persistence.writeBarrier = null
    vi.clearAllMocks()
    vi.resetModules()
  })

  test('commits a layout CAS with one durable write', async () => {
    const mod = await import('#/server/modules/settings-source.ts')
    const runtimes = await import('#/server/modules/workspace-runtimes.ts')
    const repository = mod.serverWorkspacePaneLayoutRepository
    const current = await repository.load(REPO_A)
    const writesBefore = persistence.writeUserSettingsJson.mock.calls.length
    const lease = runtimes.acquireWorkspaceRuntimeLease('user-test', REPO_A, 'client-test')
    const epochCapability = runtimes.captureWorkspaceRuntimeMembershipCapability(
      'user-test',
      REPO_A,
      lease.workspaceRuntimeId,
      'client-test',
    )

    await expect(
      repository.compareAndSwap({
        workspaceId: REPO_A,
        expected: current.layout,
        epochCapability,
        replacement: {
          entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [] }],
        },
      }),
    ).resolves.toMatchObject({ kind: 'accepted' })

    expect(persistence.writeUserSettingsJson).toHaveBeenCalledTimes(writesBefore + 1)
  })

  test('rejects a queued layout CAS when its runtime expires before the settings commit', async () => {
    const mod = await import('#/server/modules/settings-source.ts')
    const runtimes = await import('#/server/modules/workspace-runtimes.ts')
    const repository = mod.serverWorkspacePaneLayoutRepository
    const current = await repository.load(REPO_A)
    const writeStarted = Promise.withResolvers<void>()
    const resumeWrite = Promise.withResolvers<void>()
    persistence.writeBarrier = { started: writeStarted.resolve, resume: resumeWrite.promise }
    const precedingWrite = mod.addServerRecentWorkspace({ id: REPO_B })
    await writeStarted.promise

    const lease = runtimes.acquireWorkspaceRuntimeLease('user-queued', REPO_A, 'client-queued')
    const epochCapability = runtimes.captureWorkspaceRuntimeMembershipCapability(
      'user-queued',
      REPO_A,
      lease.workspaceRuntimeId,
      'client-queued',
    )
    const queuedCas = repository.compareAndSwap({
      workspaceId: REPO_A,
      expected: current.layout,
      epochCapability,
      replacement: {
        entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [] }],
      },
    })
    runtimes.releaseWorkspaceRuntimeMembershipLease('user-queued', 'client-queued', lease)
    resumeWrite.resolve()

    await precedingWrite
    await expect(queuedCas).rejects.toThrow('error.workspace-runtime-stale')
    await expect(repository.load(REPO_A)).resolves.toEqual(current)
  })

  test('serializes runtime invalidation with an in-flight durable layout commit', async () => {
    const mod = await import('#/server/modules/settings-source.ts')
    const runtimes = await import('#/server/modules/workspace-runtimes.ts')
    const repository = mod.serverWorkspacePaneLayoutRepository
    const current = await repository.load(REPO_A)
    const lease = runtimes.acquireWorkspaceRuntimeLease('user-commit', REPO_A, 'client-commit')
    const capability = runtimes.captureWorkspaceRuntimeMembershipCapability(
      'user-commit',
      REPO_A,
      lease.workspaceRuntimeId,
      'client-commit',
    )
    const committedLayout = {
      entries: [{ target: { kind: 'git-branch' as const, branch: 'committed' }, tabs: [] }],
    }
    const staleLayout = {
      entries: [{ target: { kind: 'git-branch' as const, branch: 'stale' }, tabs: [] }],
    }
    const writeStarted = Promise.withResolvers<void>()
    const resumeWrite = Promise.withResolvers<void>()
    persistence.writeBarrier = { started: writeStarted.resolve, resume: resumeWrite.promise }

    const admittedCommit = repository.compareAndSwap({
      workspaceId: REPO_A,
      expected: current.layout,
      epochCapability: capability,
      replacement: committedLayout,
    })
    await writeStarted.promise

    expect(runtimes.releaseWorkspaceRuntimeMembershipLease('user-commit', 'client-commit', lease)).toEqual({
      released: true,
      runtimeClosed: false,
    })
    const staleCommit = repository.compareAndSwap({
      workspaceId: REPO_A,
      expected: committedLayout,
      epochCapability: capability,
      replacement: staleLayout,
    })
    resumeWrite.resolve()

    await expect(admittedCommit).resolves.toMatchObject({ kind: 'accepted' })
    await expect(staleCommit).rejects.toThrow('error.workspace-runtime-stale')
    expect(runtimes.listWorkspaceRuntimes('user-commit')).toEqual([])
    await expect(repository.load(REPO_A)).resolves.toEqual({ layout: committedLayout })
    mod.resetServerSettingsSourceForTests()
    await expect(repository.load(REPO_A)).resolves.toEqual({ layout: committedLayout })
  })

  test('does not write when the workspace external app recent is already current', async () => {
    const mod = await import('#/server/modules/settings-source.ts')
    const root = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo-a/worktree-x' }, 'posix')
    if (!root) throw new Error('invalid workspace locator fixture')
    const recent = {
      workspaceId: REPO_A,
      targetKey: restorableWorkspacePaneTargetKey({ kind: 'git-worktree', root }),
      itemId: 'editor:vscode',
    }

    await mod.setServerWorkspaceExternalAppRecent(recent)
    const writesAfterFirstCommit = persistence.writeUserSettingsJson.mock.calls.length

    await mod.setServerWorkspaceExternalAppRecent(recent)

    expect(writesAfterFirstCommit).toBeGreaterThan(0)
    expect(persistence.writeUserSettingsJson).toHaveBeenCalledTimes(writesAfterFirstCommit)
  })

  test('does not expose failed settings writes through the in-memory cache', async () => {
    const mod = await import('#/server/modules/settings-source.ts')
    await mod.addServerRecentWorkspace({ id: REPO_A })
    persistence.failNextWrite = true
    await expect(mod.addServerRecentWorkspace({ id: REPO_B })).rejects.toThrow('disk full')
    expect(await mod.getServerRecentWorkspaces()).toEqual([{ id: REPO_A }])
    await expect(mod.addServerRecentWorkspace({ id: REPO_C })).resolves.toEqual([{ id: REPO_C }, { id: REPO_A }])
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
})
