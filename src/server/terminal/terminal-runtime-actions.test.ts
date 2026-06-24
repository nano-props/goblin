// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'

const CLIENT_ID = 'client_terminal_actions'
// Identity is userId-keyed under method 2: the runtime derives
// userId from the access token and threads it through to the
// manager. The test stub uses a fixed value so the assertions
// don't have to mock the derivation helper.
const USER_ID = 'user_terminal_actions'
// 16+ alphanumerics, matches TERMINAL_PTY_SESSION_ID_RE in
// shared/terminal-validators.ts.
const SESSION_ID = 'session_aaaaaaaaaaaaaa'

function makeActions(
  options: {
    closeSlotForUser: (userId: string, ptySessionId: string) => boolean
    getSlotScope?: (userId: string, ptySessionId: string) => string | undefined
    isValidTerminalClientId?: (value: unknown) => value is string
    broadcasts?: ReturnType<typeof vi.fn>
  } = { closeSlotForUser: () => false },
) {
  const broadcasts = options.broadcasts ?? vi.fn()
  const manager = {
    // The close path only reads `scope` off the session record.
    getSlot: vi.fn((_userId: string, ptySessionId: string) =>
      options.getSlotScope ? { scope: options.getSlotScope(_userId, ptySessionId) } : undefined,
    ),
    closeSlotForUser: vi.fn(options.closeSlotForUser),
    // The other manager methods are unused by `close`, but the
    // `TerminalSlotManager` type is required by the deps
    // interface. Stub them with `vi.fn()` so TypeScript stays happy.
    attachSlot: vi.fn(),
    restartSlot: vi.fn(),
    writeSlot: vi.fn(() => false),
    resizeSlot: vi.fn(() => false),
    takeoverSlot: vi.fn(),
    getSlotSnapshot: vi.fn(() => null),
  } as any
  const broker = { broadcastToUser: broadcasts as unknown as (userId: string, message: unknown) => void }
  const catalog = {
    create: vi.fn(),
    prune: vi.fn(),
    listSessions: vi.fn(),
  }
  const isValidTerminalClientId =
    options.isValidTerminalClientId ?? ((value: unknown): value is string => value === CLIENT_ID)
  return {
    actions: createTerminalRuntimeActions({
      manager,
      broker,
      catalog,
      isValidTerminalClientId,
      resolveClientConnected: () => undefined,
    }),
    broadcasts,
    manager,
  }
}

describe('terminal-runtime-actions close broadcast', () => {
  test('emits repo and targeted close broadcasts on a successful close', async () => {
    // The new sibling-window broadcast rides alongside the existing
    // `sessions-changed` list-rescan. The slot-closed event is the
    // targeted counterpart; sibling windows drop the local entry
    // immediately instead of waiting for the next reconcile.
    const close = vi.fn(() => true)
    const { actions, broadcasts } = makeActions({
      closeSlotForUser: close,
      getSlotScope: () => '/repo',
    })

    const closed = actions.close(CLIENT_ID, USER_ID, { ptySessionId: SESSION_ID })

    expect(closed).toBe(true)
    expect(close).toHaveBeenCalledWith(USER_ID, SESSION_ID)
    expect(broadcasts).toHaveBeenCalledTimes(2)
    expect(broadcasts).toHaveBeenNthCalledWith(1, USER_ID, {
      type: 'sessions-changed',
      repoRoot: '/repo',
    })
    expect(broadcasts).toHaveBeenNthCalledWith(2, USER_ID, {
      type: 'slot-closed',
      ptySessionId: SESSION_ID,
      repoRoot: '/repo',
    })
  })

  test('emits NEITHER broadcast when the close returns false (session not owned)', async () => {
    // A non-user close must not leak a phantom slot-closed to
    // sibling windows. The guard is `if (closed && repoRoot)`.
    const { actions, broadcasts } = makeActions({
      closeSlotForUser: () => false,
      getSlotScope: () => '/repo',
    })

    const closed = actions.close(CLIENT_ID, USER_ID, { ptySessionId: SESSION_ID })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('emits NEITHER broadcast when the session has no scope (lookup miss)', async () => {
    // Defensive: if `getSlot` returns undefined (e.g. the session
    // was already removed server-side by a parallel path), the close
    // path must not synthesize a slot-closed with a fake repoRoot.
    const { actions, broadcasts } = makeActions({
      closeSlotForUser: () => true,
      getSlotScope: () => undefined,
    })

    const closed = actions.close(CLIENT_ID, USER_ID, { ptySessionId: SESSION_ID })

    expect(closed).toBe(true)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects malformed input without throwing and emits nothing', async () => {
    // A ptySessionId that fails the TERMINAL_PTY_SESSION_ID_RE regex
    // (16+ alphanumerics) is rejected by the validator; the action
    // returns false and the broker is not consulted.
    const { actions, broadcasts } = makeActions({
      closeSlotForUser: () => true,
    })

    const closed = actions.close(CLIENT_ID, USER_ID, { ptySessionId: '' })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects an invalid clientId without emitting', async () => {
    // The `isValidTerminalClientId` guard is the first check. A bad
    // clientId must never reach `closeSlotForUser` (which would
    // also reject it) and must not emit a slot-closed with a
    // stale ptySessionId.
    const close = vi.fn(() => true)
    const { actions, broadcasts } = makeActions({
      closeSlotForUser: close,
      getSlotScope: () => '/repo',
    })

    const closed = actions.close('not_a_client', USER_ID, { ptySessionId: SESSION_ID })

    expect(closed).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
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
    const { actions, manager } = makeActions({ closeSlotForUser: () => false })

    actions.write(CLIENT_ID, USER_ID, { ptySessionId: SESSION_ID, data: 'x' } as never)
    actions.resize(CLIENT_ID, USER_ID, { ptySessionId: SESSION_ID, cols: 80, rows: 24 } as never)
    actions.takeover(CLIENT_ID, USER_ID, {
      ptySessionId: SESSION_ID,
      cols: 80,
      rows: 24,
    } as never)
    await actions.restart(CLIENT_ID, USER_ID, {
      ptySessionId: SESSION_ID,
      cols: 80,
      rows: 24,
    } as never)
    await actions.attach(CLIENT_ID, USER_ID, {
      ptySessionId: SESSION_ID,
      cols: 80,
      rows: 24,
    } as never)

    // Each call crossed the gate and reached the manager, passing
    // the outer CLIENT_ID as the slot-level clientId.
    expect(manager.writeSlot).toHaveBeenCalledWith(USER_ID, SESSION_ID, 'x', CLIENT_ID)
    expect(manager.resizeSlot).toHaveBeenCalledWith(USER_ID, SESSION_ID, 80, 24, CLIENT_ID, undefined)
    expect(manager.takeoverSlot).toHaveBeenCalledWith(USER_ID, SESSION_ID, 80, 24, CLIENT_ID, undefined)
    expect(manager.restartSlot).toHaveBeenCalledWith(USER_ID, SESSION_ID, 80, 24, CLIENT_ID, undefined)
    expect(manager.attachSlot).toHaveBeenCalledWith(USER_ID, SESSION_ID, 80, 24, CLIENT_ID, undefined)
  })
})
