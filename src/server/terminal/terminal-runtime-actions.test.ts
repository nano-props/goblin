// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { clearRepoRuntimesForUser, openRepoRuntime } from '#/server/modules/repo-runtimes.ts'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'
import { createTerminalSessionCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { testPhysicalWorktreeCapability } from '#/server/test-utils/physical-worktree-identity.ts'

const CLIENT_ID = 'client_terminal_actions'
// Identity is userId-keyed under method 2: the runtime derives
// userId from the access token and threads it through to the
// manager. The test stub uses a fixed value so the assertions
// don't have to mock the derivation helper.
const USER_ID = 'user_terminal_actions'
const REPO_ROOT = '/repo'
let REPO_RUNTIME_ID = ''
// 16+ alphanumerics, matches TERMINAL_RUNTIME_SESSION_ID_RE in
// shared/terminal-validators.ts.
const RUNTIME_SESSION_ID = 'session_aaaaaaaaaaaaaa'

function makeActions(
  options: {
    closeSessionForUser: (userId: string, terminalRuntimeSessionId: string) => boolean | Promise<boolean>
    getSlotScope?: (userId: string, terminalRuntimeSessionId: string) => string | undefined
    isValidTerminalClientId?: (value: unknown) => value is string
    physicalWorktreeCapability?: ReturnType<typeof testPhysicalWorktreeCapability>
    worktreeOperations?: ReturnType<typeof createPhysicalWorktreeOperationCoordinator>
    broadcasts?: ReturnType<typeof vi.fn>
  } = { closeSessionForUser: () => false },
) {
  const broadcasts = options.broadcasts ?? vi.fn()
  const physicalWorktreeCapability =
    options.physicalWorktreeCapability ?? testPhysicalWorktreeCapability(REPO_ROOT)
  const worktreeOperations = options.worktreeOperations ?? createPhysicalWorktreeOperationCoordinator()
  const manager = {
    getSessionSummaryForUser: vi.fn((userId: string, terminalRuntimeSessionId: string) =>
      options.getSlotScope?.(userId, terminalRuntimeSessionId)
          ? ({
            terminalRuntimeSessionId,
            terminalRuntimeGeneration: 1,
            terminalSessionId: 'term-111111111111111111111',
            repoRuntimeId: REPO_RUNTIME_ID,
            repoRoot: options.getSlotScope(userId, terminalRuntimeSessionId),
            branch: 'feature/worktree',
            worktreePath: '/repo',
            cwd: '/repo',
            controller: null,
            processName: 'zsh',
            canonicalTitle: null,
            phase: 'open',
            message: null,
            cols: 80,
            rows: 24,
          } as const)
        : null,
    ),
    closeSessionForUser: vi.fn(
      async (userId: string, terminalRuntimeSessionId: string) =>
        await options.closeSessionForUser(userId, terminalRuntimeSessionId),
    ),
    getPhysicalWorktreeCapabilityForUser: vi.fn(() => physicalWorktreeCapability),
    // The other manager methods are unused by `close`, but the
    // `TerminalSessionManager` type is required by the deps
    // interface. Stub them with `vi.fn()` so TypeScript stays happy.
    attachSession: vi.fn(),
    restartSession: vi.fn(),
    writeSession: vi.fn(() => false),
    resizeSession: vi.fn(() => false),
    takeoverSession: vi.fn(),
    recoverSessionsForUser: vi.fn(async () => ({
      terminalSessions: { revision: 0, sessions: [] },
      snapshots: [],
    })),
    terminalSessionsSnapshotForUser: vi.fn(() => ({ revision: 0, sessions: [] })),
  } as any
  const broker = { broadcastToUser: broadcasts as unknown as (userId: string, message: unknown) => void }
  const sessionService = {
    createAdmitted: vi.fn(),
    prune: vi.fn(),
    listSessions: vi.fn(),
    listWorkspaceTabs: vi.fn(async () => ({ revision: 0, entries: [] })),
    replaceTabs: vi.fn(async () => []),
    updateTabs: vi.fn(async () => []),
  }
  const isValidTerminalClientId =
    options.isValidTerminalClientId ?? ((value: unknown): value is string => value === CLIENT_ID)
  return {
    actions: createTerminalRuntimeActions({
      manager,
      broker,
      sessionService,
      isValidTerminalClientId,
      worktreeOperations,
    }),
    broadcasts,
    manager,
    sessionService,
    worktreeOperations,
  }
}

function syncCurrentRepoRuntime(): void {
  REPO_RUNTIME_ID = openRepoRuntime(USER_ID, REPO_ROOT)
}

describe('terminal-runtime-actions close broadcast', () => {
  test('does not emit workspace tab invalidation after a successful create', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { broadcasts, sessionService } = makeActions()
    sessionService.createAdmitted.mockResolvedValue({
      ok: true,
      action: 'created',
      terminalSessionId: 'term-111111111111111111111',
      terminalSessionsRevision: 1,
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 1,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      snapshot: '',
      snapshotSeq: 0,
      outputEra: 0,
      controller: null,
      canonicalCols: 80,
      canonicalRows: 24,
    })

    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const provider = createTerminalSessionCreateProvider({ sessionService, worktreeOperations })
    const physicalWorktreeCapability = testPhysicalWorktreeCapability('/repo', {
      userId: USER_ID,
      repoRoot: '/repo',
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    await expect(
      worktreeOperations.runOperation(physicalWorktreeCapability, async (permit) =>
        await provider.createAdmitted(CLIENT_ID, USER_ID, {
        repoRoot: '/repo',
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: 'feature/worktree',
        worktreePath: '/repo',
        kind: 'additional',
        }, { physicalWorktreeCapability, permit }),
      ),
    ).resolves.toMatchObject({ admitted: true, value: { ok: true } })

    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('does not emit workspace tab invalidation after a failed create', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { broadcasts, sessionService } = makeActions()
    sessionService.createAdmitted.mockResolvedValue({ ok: false, message: 'error.invalid-arguments' })

    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const provider = createTerminalSessionCreateProvider({ sessionService, worktreeOperations })
    const physicalWorktreeCapability = testPhysicalWorktreeCapability('/repo', {
      userId: USER_ID,
      repoRoot: '/repo',
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    await expect(
      worktreeOperations.runOperation(physicalWorktreeCapability, async (permit) =>
        await provider.createAdmitted(CLIENT_ID, USER_ID, {
        repoRoot: '/repo',
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: 'feature/worktree',
        worktreePath: '/repo',
        kind: 'additional',
        }, { physicalWorktreeCapability, permit }),
      ),
    ).resolves.toEqual({
      admitted: true,
      value: { ok: false, message: 'error.invalid-arguments' },
    })

    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('does not emit workspace tab invalidation when admitted create validation fails', async () => {
    clearRepoRuntimesForUser(USER_ID)
    const { broadcasts, sessionService } = makeActions()
    sessionService.createAdmitted.mockResolvedValue({ ok: false, message: 'error.invalid-arguments' })

    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const provider = createTerminalSessionCreateProvider({ sessionService, worktreeOperations })
    const physicalWorktreeCapability = testPhysicalWorktreeCapability('/repo', {
      userId: USER_ID,
      repoRoot: '',
      repoRuntimeId: 'repo-runtime-stale',
    })
    await expect(
      worktreeOperations.runOperation(physicalWorktreeCapability, async (permit) =>
        await provider.createAdmitted(CLIENT_ID, USER_ID, {
        repoRoot: '',
        repoRuntimeId: 'repo-runtime-stale',
        branch: 'feature/worktree',
        worktreePath: '/repo',
        kind: 'additional',
        }, { physicalWorktreeCapability, permit }),
      ),
    ).resolves.toEqual({
      admitted: true,
      value: { ok: false, message: 'error.invalid-arguments' },
    })

    expect(sessionService.createAdmitted).toHaveBeenCalledOnce()
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('emits targeted close broadcast on a successful close', async () => {
    // Repo/session-list invalidation is owned by the manager close
    // lifecycle. The action owns only the targeted sibling-window
    // event that lets clients drop the local entry immediately.
    const close = vi.fn(() => true)
    const { actions, broadcasts } = makeActions({
      closeSessionForUser: close,
      getSlotScope: () => '/repo',
    })

    const closed = await actions.close(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID })

    expect(closed).toBe(true)
    expect(close).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID)
    expect(broadcasts).toHaveBeenCalledTimes(1)
    expect(broadcasts).toHaveBeenCalledWith(USER_ID, {
      type: 'session-closed',
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: '/repo',
      worktreePath: '/repo',
    })
  })

  test('emits NEITHER broadcast when the close returns false (session not owned)', async () => {
    // A non-user close must not leak a phantom session-closed to
    // sibling windows. The guard is `if (closed && repoRoot)`.
    const { actions, broadcasts } = makeActions({
      closeSessionForUser: () => false,
      getSlotScope: () => '/repo',
    })

    const closed = await actions.close(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('emits NEITHER broadcast when the session has no scope (lookup miss)', async () => {
    // Defensive: if the scope lookup misses (e.g. the session
    // was already removed server-side by a parallel path), the close
    // path must not synthesize a session-closed with a fake repoRoot.
    const { actions, broadcasts } = makeActions({
      closeSessionForUser: () => true,
      getSlotScope: () => undefined,
    })

    const closed = await actions.close(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID })

    expect(closed).toBe(true)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects malformed input without throwing and emits nothing', async () => {
    // A terminalRuntimeSessionId that fails the TERMINAL_RUNTIME_SESSION_ID_RE regex
    // (16+ alphanumerics) is rejected by the validator; the action
    // returns false and the broker is not consulted.
    const { actions, broadcasts } = makeActions({
      closeSessionForUser: () => true,
    })

    const closed = await actions.close(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: '' })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects an invalid clientId without emitting', async () => {
    // The `isValidTerminalClientId` guard is the first check. A bad
    // clientId must never reach `closeSessionForUser` (which would
    // also reject it) and must not emit a session-closed with a
    // stale terminalRuntimeSessionId.
    const close = vi.fn(() => true)
    const { actions, broadcasts } = makeActions({
      closeSessionForUser: close,
      getSlotScope: () => '/repo',
    })

    const closed = await actions.close('not_a_client', USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID })

    expect(closed).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })
})

describe('terminal-runtime-actions prune', () => {
  test('rejects stale repo-runtime prune requests before touching session state', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts, sessionService } = makeActions({ closeSessionForUser: () => false })

    await expect(
      actions.prune(CLIENT_ID, USER_ID, {
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-stale',
      }),
    ).rejects.toThrow('error.repo-runtime-stale')

    expect(sessionService.prune).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })
})

describe('terminal-runtime-actions recovery projection', () => {
  test('retries only when the terminal projection revision changes during recovery', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, manager, sessionService } = makeActions()
    manager.recoverSessionsForUser
      .mockResolvedValueOnce({ terminalSessions: { revision: 1, sessions: [] }, snapshots: [] })
      .mockResolvedValueOnce({ terminalSessions: { revision: 2, sessions: [] }, snapshots: [] })
    manager.terminalSessionsSnapshotForUser
      .mockReturnValueOnce({ revision: 2, sessions: [] })
      .mockReturnValueOnce({ revision: 2, sessions: [] })
    sessionService.listWorkspaceTabs
      .mockResolvedValueOnce({ revision: 8, entries: [] })
      .mockResolvedValueOnce({ revision: 9, entries: [] })

    await expect(
      actions.recoverSessions(CLIENT_ID, USER_ID, { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }),
    ).resolves.toEqual({
      terminalSessions: { revision: 2, sessions: [] },
      snapshots: [],
      workspacePaneTabs: { revision: 9, entries: [] },
    })

    expect(manager.recoverSessionsForUser).toHaveBeenCalledTimes(2)
  })

  test('does not use the workspace-tabs revision as terminal freshness', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, manager, sessionService } = makeActions()
    manager.recoverSessionsForUser.mockResolvedValueOnce({
      terminalSessions: { revision: 4, sessions: [] },
      snapshots: [],
    })
    manager.terminalSessionsSnapshotForUser.mockReturnValueOnce({ revision: 4, sessions: [] })
    sessionService.listWorkspaceTabs.mockResolvedValueOnce({ revision: 27, entries: [] })

    await expect(
      actions.recoverSessions(CLIENT_ID, USER_ID, { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }),
    ).resolves.toEqual({
      terminalSessions: { revision: 4, sessions: [] },
      snapshots: [],
      workspacePaneTabs: { revision: 27, entries: [] },
    })
    expect(manager.recoverSessionsForUser).toHaveBeenCalledOnce()
  })
})

describe('terminal-runtime-actions clientId gate', () => {
  // The action layer is the single point that validates caller
  // identity before reaching the manager. Every authority-gated
  // action (write / resize / takeover / restart / attach) accepts a
  // missing `input.clientId` and falls back to the outer
  // (request-level) `clientId`. The manager sees a single string,
  // never undefined, and the manager's tightened
  // `clientId: string` (no longer optional) contract holds.
  test('write / resize / takeover / restart / attach all fall back to outer clientId when input omits it', async () => {
    const { actions, manager } = makeActions({ closeSessionForUser: () => false })

    actions.write(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID, data: 'x' } as never)
    actions.resize(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID, cols: 80, rows: 24 } as never)
    actions.takeover(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      cols: 80,
      rows: 24,
    } as never)
    await actions.restart(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      cols: 80,
      rows: 24,
    } as never)
    await actions.attach(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      cols: 80,
      rows: 24,
    } as never)

    // Each call crossed the gate and reached the manager, passing
    // the outer CLIENT_ID as the session-level clientId.
    expect(manager.writeSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 'x', CLIENT_ID)
    expect(manager.resizeSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 80, 24, CLIENT_ID)
    expect(manager.takeoverSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 80, 24, CLIENT_ID)
    expect(manager.restartSession).toHaveBeenCalledWith(
      USER_ID,
      RUNTIME_SESSION_ID,
      80,
      24,
      CLIENT_ID,
      expect.any(AbortSignal),
    )
    expect(manager.attachSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 80, 24, CLIENT_ID)
  })

  test('restart rejects invalid arguments before looking up the session scope', async () => {
    const { actions, manager } = makeActions({
      closeSessionForUser: () => false,
      getSlotScope: () => '/repo',
    })

    await expect(actions.restart(CLIENT_ID, USER_ID, undefined as never)).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      actions.restart('not_a_client', USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        cols: 80,
        rows: 24,
      } as never),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      actions.restart(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        cols: 0,
        rows: 24,
      } as never),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(manager.getSessionSummaryForUser).not.toHaveBeenCalled()
    expect(manager.restartSession).not.toHaveBeenCalled()
  })

  test('restart cannot spawn a replacement PTY while physical worktree removal is admitted', async () => {
    const physicalWorktreeCapability = testPhysicalWorktreeCapability(REPO_ROOT)
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const { actions, manager } = makeActions({
      closeSessionForUser: () => false,
      getSlotScope: () => REPO_ROOT,
      physicalWorktreeCapability,
      worktreeOperations,
    })
    const releaseRemoval = Promise.withResolvers<void>()
    const removalStarted = Promise.withResolvers<void>()
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, async () => {
      removalStarted.resolve()
      await releaseRemoval.promise
    })
    await removalStarted.promise

    await expect(
      actions.restart(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        cols: 80,
        rows: 24,
      } as never),
    ).resolves.toEqual({ ok: false, message: 'error.worktree-removal-in-progress' })
    expect(manager.restartSession).not.toHaveBeenCalled()
    releaseRemoval.resolve()
    await removal
  })

  test('removal waits for an admitted restart operation to settle', async () => {
    const physicalWorktreeCapability = testPhysicalWorktreeCapability(REPO_ROOT)
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const { actions, manager } = makeActions({
      closeSessionForUser: () => false,
      getSlotScope: () => REPO_ROOT,
      physicalWorktreeCapability,
      worktreeOperations,
    })
    const restartResult = Promise.withResolvers<{ ok: false; message: string }>()
    manager.restartSession.mockImplementation(async () => await restartResult.promise)
    const restart = actions.restart(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      cols: 80,
      rows: 24,
    } as never)
    await vi.waitFor(() => expect(manager.restartSession).toHaveBeenCalledOnce())
    const removalTask = vi.fn(async () => undefined)
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, removalTask)
    await Promise.resolve()
    expect(removalTask).not.toHaveBeenCalled()

    restartResult.resolve({ ok: false, message: 'restart stopped' })
    await expect(restart).resolves.toEqual({ ok: false, message: 'restart stopped' })
    await expect(removal).resolves.toEqual({ admitted: true, value: undefined })
    expect(removalTask).toHaveBeenCalledOnce()
  })
})
