// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  captureWorkspaceRuntimeMembershipCapability,
  clearWorkspaceRuntimesForUser,
  releaseWorkspaceRuntime,
} from '#/server/modules/workspace-runtimes.ts'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import type { TerminalSessionCloseOutcome } from '#/server/terminal/terminal-session-close.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'

const CLIENT_ID = 'client_terminal_actions'
const USER_ID = 'user_terminal_actions'
const REPO_ROOT = 'goblin+file:///repo'
let WORKSPACE_RUNTIME_ID = ''
const WORKSPACE_ID = requiredWorkspaceLocator(REPO_ROOT)

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

function worktreeTarget(workspaceRuntimeId: string) {
  return {
    kind: 'git-worktree' as const,
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId,
    root: WORKSPACE_ID,
  }
}
// 16+ alphanumerics, matches TERMINAL_RUNTIME_SESSION_ID_RE in
// shared/terminal-validators.ts.
const RUNTIME_SESSION_ID = 'session_aaaaaaaaaaaaaa'

function terminalCloseOutcome(): TerminalSessionCloseOutcome {
  return {
    kind: 'closed',
    session: {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      terminalSessionId: 'term-111111111111111111111',
      target: worktreeTarget(WORKSPACE_RUNTIME_ID),
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/worktree' } },
      controller: null,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      canonicalSize: { cols: 80, rows: 24 },
    },
    tabsBeforeRetirement: null,
  }
}

function makeActions(
  options: {
    closeSessionForUserOutcome?: (
      userId: string,
      terminalRuntimeSessionId: string,
    ) => TerminalSessionCloseOutcome | Promise<TerminalSessionCloseOutcome>
    physicalWorktreeCapability?: ReturnType<typeof testPhysicalWorktreeExecutionCapability>
    worktreeOperations?: ReturnType<typeof createPhysicalWorktreeOperationCoordinator>
  } = {},
) {
  const broadcasts = vi.fn()
  const closeSessionForUserOutcome = options.closeSessionForUserOutcome ?? (() => ({ kind: 'already-closed' as const }))
  const physicalWorktreeCapability =
    options.physicalWorktreeCapability ?? testPhysicalWorktreeExecutionCapability(REPO_ROOT)
  const worktreeOperations = options.worktreeOperations ?? createPhysicalWorktreeOperationCoordinator()
  const manager = {
    closeSessionForUserOutcome: vi.fn(
      async (userId: string, terminalRuntimeSessionId: string) =>
        await closeSessionForUserOutcome(userId, terminalRuntimeSessionId),
    ),
    getPhysicalWorktreeExecutionCapabilityForUser: vi.fn(() => physicalWorktreeCapability),
    attachSession: vi.fn(),
    restartSessionWithProjectionOutcome: vi.fn(async () => ({
      result: { ok: false as const, message: 'restart not configured' },
      projectionChanged: null,
    })),
    writeSession: vi.fn(async () => ({ status: 'rejected' as const })),
    resizeSession: vi.fn(async () => ({ ok: false as const, message: 'resize not configured' })),
    takeoverSession: vi.fn(),
    terminalSessionsSnapshotForUser: vi.fn(() => ({ revision: 0, sessions: [] })),
  }
  const broker = { broadcastToUser: broadcasts as unknown as (userId: string, message: unknown) => void }
  const sessionService = {
    listSessions: vi.fn(),
  }
  return {
    actions: createTerminalRuntimeActions({
      manager,
      broker,
      sessionService,
      isValidTerminalClientId: (value: unknown): value is string => value === CLIENT_ID,
      captureWorkspaceRuntimeMembershipCapability,
      worktreeOperations,
    }),
    broadcasts,
    manager,
    sessionService,
  }
}

function syncCurrentWorkspaceRuntime(): void {
  WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_ID, WORKSPACE_ID, CLIENT_ID)
}

describe('terminal-runtime-actions membership', () => {
  test('rejects workspace-scoped actions after the calling client releases its membership', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const otherClientId = 'client_terminal_actions_other'
    expect(acquireWorkspaceRuntime(USER_ID, WORKSPACE_ID, otherClientId)).toBe(WORKSPACE_RUNTIME_ID)
    expect(releaseWorkspaceRuntime(USER_ID, WORKSPACE_ID, WORKSPACE_RUNTIME_ID, CLIENT_ID)).toEqual({
      released: true,
      runtimeClosed: false,
    })
    const { actions, manager, sessionService } = makeActions()
    const input = { workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }

    await expect(actions.recoverSessions(CLIENT_ID, USER_ID, input)).rejects.toThrow('error.workspace-runtime-stale')
    await expect(actions.listSessions(CLIENT_ID, USER_ID, input)).rejects.toThrow('error.workspace-runtime-stale')
    expect(sessionService.listSessions).not.toHaveBeenCalled()
    expect(manager.terminalSessionsSnapshotForUser).not.toHaveBeenCalled()
  })
})

describe('terminal-runtime-actions close broadcast', () => {
  test('emits targeted close broadcast on a successful close', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    // Repo/session-list invalidation is owned by the manager close
    // lifecycle. The action owns only the targeted sibling-window
    // event that lets clients drop the local entry immediately.
    const close = vi.fn(terminalCloseOutcome)
    const { actions, broadcasts } = makeActions({
      closeSessionForUserOutcome: close,
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
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: null,
    })
  })

  test('does not broadcast when the session is not owned', async () => {
    const { actions, broadcasts } = makeActions({
      closeSessionForUserOutcome: () => ({ kind: 'failed' }),
    })

    const closed = await actions.close(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('reports an already-closed workspace pane outcome when session authority was removed', async () => {
    const { actions, broadcasts } = makeActions({
      closeSessionForUserOutcome: () => ({ kind: 'already-closed' }),
    })

    await expect(
      actions.closeForWorkspacePane(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID }),
    ).resolves.toEqual({ kind: 'already-closed' })
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects malformed input without throwing and emits nothing', async () => {
    // A terminalRuntimeSessionId that fails the TERMINAL_RUNTIME_SESSION_ID_RE regex
    // (16+ alphanumerics) is rejected by the validator; the action
    // returns false and the broker is not consulted.
    const { actions, broadcasts } = makeActions({
      closeSessionForUserOutcome: terminalCloseOutcome,
    })

    const closed = await actions.close(CLIENT_ID, USER_ID, { terminalRuntimeSessionId: '' })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects an invalid clientId without emitting', async () => {
    // The `isValidTerminalClientId` guard is the first check. A bad
    // clientId must never reach `closeSessionForUserOutcome` (which would
    // also reject it) and must not emit a session-closed with a
    // stale terminalRuntimeSessionId.
    const close = vi.fn(terminalCloseOutcome)
    const { actions, broadcasts } = makeActions({
      closeSessionForUserOutcome: close,
    })

    const closed = await actions.close('not_a_client', USER_ID, { terminalRuntimeSessionId: RUNTIME_SESSION_ID })

    expect(closed).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })
})

describe('terminal-runtime-actions catalog recovery', () => {
  test('returns a single screen-free catalog sample from the manager', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const { actions, manager } = makeActions()
    manager.terminalSessionsSnapshotForUser.mockReturnValueOnce({ revision: 2, sessions: [] })

    await expect(
      actions.recoverSessions(CLIENT_ID, USER_ID, {
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      }),
    ).resolves.toEqual({ revision: 2, sessions: [] })

    expect(manager.terminalSessionsSnapshotForUser).toHaveBeenCalledOnce()
  })
})

describe('terminal-runtime-actions mutation admission', () => {
  test('rejects unbound generations before write, resize, or takeover reach the manager', async () => {
    const { actions, manager } = makeActions()

    await expect(
      actions.write(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 0,
        data: 'x',
      }),
    ).resolves.toEqual({ status: 'rejected' })
    await expect(
      actions.resize(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })
    await expect(
      actions.takeover(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })

    expect(manager.writeSession).not.toHaveBeenCalled()
    expect(manager.resizeSession).not.toHaveBeenCalled()
    expect(manager.takeoverSession).not.toHaveBeenCalled()
  })

  test('write / resize / takeover / restart / attach use the authenticated connection clientId', async () => {
    const { actions, manager } = makeActions()

    await actions.write(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      data: 'x',
    })
    await actions.resize(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    await actions.takeover(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    await actions.restart(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    await actions.attach(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })

    // Each call crossed the gate and reached the manager, passing
    // the outer CLIENT_ID as the session-level clientId.
    expect(manager.writeSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 1, 'x', CLIENT_ID)
    expect(manager.resizeSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 1, 80, 24, CLIENT_ID)
    expect(manager.takeoverSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 1, 80, 24, CLIENT_ID)
    expect(manager.restartSessionWithProjectionOutcome).toHaveBeenCalledWith(
      USER_ID,
      RUNTIME_SESSION_ID,
      1,
      80,
      24,
      CLIENT_ID,
      expect.any(AbortSignal),
    )
    expect(manager.attachSession).toHaveBeenCalledWith(USER_ID, RUNTIME_SESSION_ID, 1, 80, 24, CLIENT_ID)
  })

  test('restart rejects invalid arguments before looking up the session scope', async () => {
    const { actions, manager } = makeActions()

    await expect(actions.restart(CLIENT_ID, USER_ID, undefined as never)).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      actions.restart('not_a_client', USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 1,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      actions.restart(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 1,
        cols: 0,
        rows: 24,
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(manager.restartSessionWithProjectionOutcome).not.toHaveBeenCalled()
  })

  test('restart cannot spawn a replacement PTY while physical worktree removal is admitted', async () => {
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(REPO_ROOT)
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const { actions, manager } = makeActions({
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
        terminalRuntimeGeneration: 1,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.worktree-removal-in-progress' })
    expect(manager.restartSessionWithProjectionOutcome).not.toHaveBeenCalled()
    releaseRemoval.resolve()
    await removal
  })

  test('restart failure without a projection mutation does not broadcast sessions changed', async () => {
    const { actions, manager, broadcasts } = makeActions()
    manager.restartSessionWithProjectionOutcome.mockResolvedValueOnce({
      result: { ok: false, message: 'restart rejected' },
      projectionChanged: null,
    })

    await expect(
      actions.restart(CLIENT_ID, USER_ID, {
        terminalRuntimeSessionId: RUNTIME_SESSION_ID,
        terminalRuntimeGeneration: 1,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'restart rejected' })

    expect(broadcasts).not.toHaveBeenCalledWith(USER_ID, expect.objectContaining({ type: 'sessions-changed' }))
  })

  test('removal waits for an admitted restart operation to settle', async () => {
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(REPO_ROOT)
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const { actions, manager } = makeActions({
      physicalWorktreeCapability,
      worktreeOperations,
    })
    const restartResult = Promise.withResolvers<{
      result: { ok: false; message: string }
      projectionChanged: null
    }>()
    manager.restartSessionWithProjectionOutcome.mockImplementation(async () => await restartResult.promise)
    const restart = actions.restart(CLIENT_ID, USER_ID, {
      terminalRuntimeSessionId: RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    await vi.waitFor(() => expect(manager.restartSessionWithProjectionOutcome).toHaveBeenCalledOnce())
    const removalTask = vi.fn(async () => undefined)
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, removalTask)
    await flushMicrotasks()
    expect(removalTask).not.toHaveBeenCalled()

    restartResult.resolve({ result: { ok: false, message: 'restart stopped' }, projectionChanged: null })
    await expect(restart).resolves.toEqual({ ok: false, message: 'restart stopped' })
    await expect(removal).resolves.toEqual({ admitted: true, value: undefined })
    expect(removalTask).toHaveBeenCalledOnce()
  })
})
