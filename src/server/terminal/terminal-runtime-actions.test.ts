// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { clearRepoRuntimesForUser, openRepoRuntime } from '#/server/modules/repo-runtimes.ts'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'

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
    removalAdmitted?: boolean
    broadcasts?: ReturnType<typeof vi.fn>
  } = { closeSessionForUser: () => false },
) {
  const broadcasts = options.broadcasts ?? vi.fn()
  const manager = {
    getSessionSummaryForUser: vi.fn((userId: string, terminalRuntimeSessionId: string) =>
      options.getSlotScope?.(userId, terminalRuntimeSessionId)
        ? ({
            terminalRuntimeSessionId,
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
    // The other manager methods are unused by `close`, but the
    // `TerminalSessionManager` type is required by the deps
    // interface. Stub them with `vi.fn()` so TypeScript stays happy.
    attachSession: vi.fn(),
    restartSession: vi.fn(),
    writeSession: vi.fn(() => false),
    resizeSession: vi.fn(() => false),
    takeoverSession: vi.fn(),
    recoverSessionsForUser: vi.fn(async () => ({ sessions: [], snapshots: [] })),
  } as any
  const broker = { broadcastToUser: broadcasts as unknown as (userId: string, message: unknown) => void }
  const sessionService = {
    create: vi.fn(),
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
      worktreeOperations: { isRemovalAdmitted: () => options.removalAdmitted ?? false },
    }),
    broadcasts,
    manager,
    sessionService,
  }
}

function syncCurrentRepoRuntime(): void {
  REPO_RUNTIME_ID = openRepoRuntime(USER_ID, REPO_ROOT)
}

describe('terminal-runtime-actions close broadcast', () => {
  test('does not emit workspace tab invalidation after a successful create', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts, sessionService } = makeActions()
    sessionService.create.mockResolvedValue({
      ok: true,
      action: 'created',
      terminalSessionId: 'term-111111111111111111111',
      sessions: [],
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
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

    await expect(
      actions.create(CLIENT_ID, USER_ID, {
        repoRoot: '/repo',
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: 'feature/worktree',
        worktreePath: '/repo',
        kind: 'additional',
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('does not emit workspace tab invalidation after a failed create', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts, sessionService } = makeActions()
    sessionService.create.mockResolvedValue({ ok: false, message: 'error.invalid-arguments' })

    await expect(
      actions.create(CLIENT_ID, USER_ID, {
        repoRoot: '/repo',
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: 'feature/worktree',
        worktreePath: '/repo',
        kind: 'additional',
      }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })

    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects invalid create input before checking repo runtime freshness', async () => {
    clearRepoRuntimesForUser(USER_ID)
    const { actions, broadcasts, sessionService } = makeActions()

    await expect(
      actions.create(CLIENT_ID, USER_ID, {
        repoRoot: '',
        repoRuntimeId: 'repo-runtime-stale',
        branch: 'feature/worktree',
        worktreePath: '/repo',
        kind: 'additional',
      }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })

    expect(sessionService.create).not.toHaveBeenCalled()
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
  test('retries until sessions and canonical tabs share one stable server revision', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, manager, sessionService } = makeActions()
    sessionService.listWorkspaceTabs
      .mockResolvedValueOnce({ revision: 1, entries: [] })
      .mockResolvedValueOnce({ revision: 2, entries: [] })
      .mockResolvedValueOnce({ revision: 2, entries: [] })
      .mockResolvedValueOnce({ revision: 2, entries: [] })

    await expect(
      actions.recoverSessions(CLIENT_ID, USER_ID, { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }),
    ).resolves.toEqual({ sessions: [], snapshots: [], workspacePaneTabs: { revision: 2, entries: [] } })

    expect(manager.recoverSessionsForUser).toHaveBeenCalledTimes(2)
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
    expect(manager.restartSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 80, 24, CLIENT_ID)
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
    const { actions, manager } = makeActions({
      closeSessionForUser: () => false,
      getSlotScope: () => REPO_ROOT,
      removalAdmitted: true,
    })

    await expect(
      actions.restart(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        cols: 80,
        rows: 24,
      } as never),
    ).resolves.toEqual({ ok: false, message: 'error.worktree-removal-in-progress' })
    expect(manager.restartSession).not.toHaveBeenCalled()
  })
})
