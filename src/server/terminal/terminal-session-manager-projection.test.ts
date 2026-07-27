import { describe, expect, test, vi } from 'vitest'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import {
  CLIENT_ID,
  TERMINAL_SESSION_ID,
  USER_ID,
  WORKSPACE_ID,
  WORKTREE_PATH,
  WORKTREE_TARGET,
  createAlwaysOnlineManager,
  createDeferredPtySupervisor,
  createSession,
  ensureSession,
  ptySpawnSuccess,
} from '#/server/test-utils/terminal-session-manager.ts'

describe('TerminalSessionManager membership catalog', () => {
  test('advances the projection revision for binding and close, not incremental runtime details', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const beforeBinding = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(beforeBinding.sessions[0]).toMatchObject({
      terminalRuntimeGeneration: 0,
      processName: 'terminal',
      canonicalSize: null,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_revision_123456'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const createdSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(createdSnapshot.revision).toBe(beforeBinding.revision + 1)
    expect(createdSnapshot.sessions).toEqual([
      expect.objectContaining({
        terminalSessionId: TERMINAL_SESSION_ID,
        processName: 'zsh',
        phase: 'open',
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])

    supervisor.emitData('pty_revision_123456', 'first output')
    const openedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(openedSnapshot.revision).toBe(createdSnapshot.revision)
    expect(openedSnapshot.sessions[0]).toMatchObject({ phase: 'open' })

    supervisor.emitData('pty_revision_123456', 'ordinary output')
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, scope).revision).toBe(openedSnapshot.revision)

    supervisor.setProcessName('node')
    supervisor.emitData('pty_revision_123456', 'process changed')
    const processSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(processSnapshot.revision).toBe(openedSnapshot.revision)
    expect(processSnapshot.sessions[0]).toMatchObject({ processName: 'node' })

    const beforeResize = processSnapshot.revision
    await expect(
      manager.resizeSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration + 1,
        100,
        30,
        CLIENT_ID,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, scope).sessions[0]).toMatchObject({
      canonicalSize: { cols: 80, rows: 24 },
    })
    await expect(
      manager.resizeSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        100,
        30,
        CLIENT_ID,
      ),
    ).resolves.toEqual({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      terminalRuntimeGeneration: created.terminalRuntimeGeneration,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: CLIENT_ID, status: 'connected' },
      canonicalSize: { cols: 100, rows: 30 },
    })
    const resizedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(resizedSnapshot.revision).toBe(beforeResize)
    expect(resizedSnapshot.sessions[0]).toMatchObject({ canonicalSize: { cols: 100, rows: 30 } })

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    const closedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(closedSnapshot.revision).toBe(resizedSnapshot.revision + 1)
    expect(closedSnapshot.sessions).toEqual([])
  })
})

describe('TerminalSessionManager runtime binding generations', () => {
  test('publishes the PTY binding generation on response frames and realtime events', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onOutput })
    const created = await createSession(manager, supervisor)
    expect(created.terminalRuntimeGeneration).toBe(1)

    supervisor.emitData('pty_initial_123456', 'first')
    expect(onOutput).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ terminalRuntimeGeneration: 1 }))

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_generation_two_123'))
    await expect(restart).resolves.toMatchObject({ ok: true, frame: 'stream', terminalRuntimeGeneration: 2 })

    supervisor.emitData('pty_generation_two_123', 'second')
    expect(onOutput).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ terminalRuntimeGeneration: 2 }))
  })
})
