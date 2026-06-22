// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'

const CLIENT_ID = 'client_terminal_actions'
// Identity is ownerId-keyed under method 2: the runtime derives
// ownerId from the access token and threads it through to the
// manager. The test stub uses a fixed value so the assertions
// don't have to mock the derivation helper.
const OWNER_ID = 'owner_terminal_actions'
// 16+ alphanumerics, matches TERMINAL_SESSION_ID_RE in
// shared/terminal-validators.ts.
const SESSION_ID = 'session_aaaaaaaaaaaaaa'

function makeActions(
  options: {
    closeSessionForOwner: (ownerId: string, sessionId: string) => boolean
    getSessionScope?: (ownerId: string, sessionId: string) => string | undefined
    isValidTerminalClientId?: (value: unknown) => value is string
    broadcasts?: ReturnType<typeof vi.fn>
  } = { closeSessionForOwner: () => false },
) {
  const broadcasts = options.broadcasts ?? vi.fn()
  const manager = {
    // The close path only reads `scope` off the session record.
    getSession: vi.fn((_ownerId: string, sessionId: string) =>
      options.getSessionScope ? { scope: options.getSessionScope(_ownerId, sessionId) } : undefined,
    ),
    closeSessionForOwner: vi.fn(options.closeSessionForOwner),
    // The other manager methods are unused by `close`, but the
    // `TerminalSessionManager` type is required by the deps
    // interface. Stub them with `vi.fn()` so TypeScript stays happy.
    attachSession: vi.fn(),
    restartSession: vi.fn(),
    writeSession: vi.fn(() => false),
    resizeSession: vi.fn(() => false),
    takeoverSession: vi.fn(),
    getSessionSnapshot: vi.fn(() => null),
  } as any
  const broker = { broadcastToOwner: broadcasts as unknown as (ownerId: string, message: unknown) => void }
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
      resolveAttachmentConnected: () => undefined,
    }),
    broadcasts,
    manager,
  }
}

describe('terminal-runtime-actions close broadcast', () => {
  test('emits repo and targeted close broadcasts on a successful close', async () => {
    // The new sibling-window broadcast rides alongside the existing
    // `sessions-changed` list-rescan. The session-closed event is the
    // targeted counterpart; sibling windows drop the local entry
    // immediately instead of waiting for the next reconcile.
    const close = vi.fn(() => true)
    const { actions, broadcasts } = makeActions({
      closeSessionForOwner: close,
      getSessionScope: () => '/repo',
    })

    const closed = actions.close(CLIENT_ID, OWNER_ID, { sessionId: SESSION_ID })

    expect(closed).toBe(true)
    expect(close).toHaveBeenCalledWith(OWNER_ID, SESSION_ID)
    expect(broadcasts).toHaveBeenCalledTimes(2)
    expect(broadcasts).toHaveBeenNthCalledWith(1, OWNER_ID, {
      type: 'sessions-changed',
      repoRoot: '/repo',
    })
    expect(broadcasts).toHaveBeenNthCalledWith(2, OWNER_ID, {
      type: 'session-closed',
      sessionId: SESSION_ID,
      repoRoot: '/repo',
    })
  })

  test('emits NEITHER broadcast when the close returns false (session not owned)', async () => {
    // A non-owner close must not leak a phantom session-closed to
    // sibling windows. The guard is `if (closed && repoRoot)`.
    const { actions, broadcasts } = makeActions({
      closeSessionForOwner: () => false,
      getSessionScope: () => '/repo',
    })

    const closed = actions.close(CLIENT_ID, OWNER_ID, { sessionId: SESSION_ID })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('emits NEITHER broadcast when the session has no scope (lookup miss)', async () => {
    // Defensive: if `getSession` returns undefined (e.g. the session
    // was already removed server-side by a parallel path), the close
    // path must not synthesize a session-closed with a fake repoRoot.
    const { actions, broadcasts } = makeActions({
      closeSessionForOwner: () => true,
      getSessionScope: () => undefined,
    })

    const closed = actions.close(CLIENT_ID, OWNER_ID, { sessionId: SESSION_ID })

    expect(closed).toBe(true)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects malformed input without throwing and emits nothing', async () => {
    // A sessionId that fails the TERMINAL_SESSION_ID_RE regex
    // (16+ alphanumerics) is rejected by the validator; the action
    // returns false and the broker is not consulted.
    const { actions, broadcasts } = makeActions({
      closeSessionForOwner: () => true,
    })

    const closed = actions.close(CLIENT_ID, OWNER_ID, { sessionId: '' })

    expect(closed).toBe(false)
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects an invalid clientId without emitting', async () => {
    // The `isValidTerminalClientId` guard is the first check. A bad
    // clientId must never reach `closeSessionForOwner` (which would
    // also reject it) and must not emit a session-closed with a
    // stale sessionId.
    const close = vi.fn(() => true)
    const { actions, broadcasts } = makeActions({
      closeSessionForOwner: close,
      getSessionScope: () => '/repo',
    })

    const closed = actions.close('not_a_client', OWNER_ID, { sessionId: SESSION_ID })

    expect(closed).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })
})
