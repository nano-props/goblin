import { describe, expect, test, vi } from 'vitest'
import { acquireWorkspaceRuntime } from '#/server/modules/workspace-runtimes.ts'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import {
  DETACHED_TTL_MS,
  REPO_ROOT,
  USER_1,
  USER_2,
  USER_2_WORKSPACE_RUNTIME_ID,
  WORKSPACE_RUNTIME_ID,
  appRealtimeSocket,
  buildRuntime,
  commitTerminalReadyProbe,
  createAdmittedTerminal,
  createLocalWorktreeTerminal,
  createTerminalSession,
  mockPtys,
  requestWorkspacePaneTabs,
  setWorkspaceRuntimeId,
  startControlledTerminalRuntime,
  workspacePaneTabsListInput,
} from '#/server/test-utils/terminal-runtime.ts'

describe('server terminal runtime user presence', () => {
  test('lists repo sessions across clients sharing a userId and broadcasts lifecycle invalidations to that user', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client2_b', USER_1, socketB)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    expect(result.ok).toBe(true)

    acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_2')
    const sessions = await host.listSessions('client_2', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.terminalRuntimeSessionId).toBe(terminalRuntimeSessionId)

    expect(
      socketB.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.workspaceId === REPO_ROOT
      }),
    ).toBe(true)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client2_b', USER_1, socketB)
    shutdown()
  })

  test('isolates terminal session service reads and lifecycle broadcasts by userId', async () => {
    const { host, shutdown } = buildRuntime()
    const userASocket = appRealtimeSocket()
    const userBSocket = appRealtimeSocket()
    host.registerSocket('client_shared_attachment_a', USER_1, userASocket)
    host.registerSocket('client_shared_attachment_b', USER_2, userBSocket)

    const userACreate = await createLocalWorktreeTerminal(host, 'client_shared', USER_1, 'additional')
    expect(userACreate.ok).toBe(true)
    if (!userACreate.ok) return
    const userASession = {
      terminalRuntimeSessionId: userACreate.terminalRuntimeSessionId,
      terminalRuntimeGeneration: 0,
      terminalSessionId: userACreate.terminalSessionId,
    }

    acquireWorkspaceRuntime(USER_2, REPO_ROOT, 'client_shared')
    expect(
      await host.listSessions('client_shared', USER_2, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: USER_2_WORKSPACE_RUNTIME_ID,
      }),
    ).toEqual([])
    await expect(
      host.close('client_shared', USER_2, { terminalRuntimeSessionId: userASession.terminalRuntimeSessionId }),
    ).resolves.toBe(false)
    expect(
      userBSocket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.workspaceId === REPO_ROOT
      }),
    ).toBe(false)

    const userBCreate = await createAdmittedTerminal(host, 'client_shared', USER_2, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: USER_2_WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
    })
    expect(userBCreate.ok).toBe(true)
    if (!userBCreate.ok) return
    const userBSession = {
      terminalRuntimeSessionId: userBCreate.terminalRuntimeSessionId,
      terminalRuntimeGeneration: 0,
      terminalSessionId: userBCreate.terminalSessionId,
    }

    expect(userBSession.terminalSessionId).not.toBe(userASession.terminalSessionId)
    expect(userBSession.terminalRuntimeSessionId).not.toBe(userASession.terminalRuntimeSessionId)
    expect(
      await host.listSessions('client_shared', USER_1, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      }),
    ).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: userASession.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        terminalSessionId: userASession.terminalSessionId,
      }),
    ])
    expect(
      await host.listSessions('client_shared', USER_2, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: USER_2_WORKSPACE_RUNTIME_ID,
      }),
    ).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: userBSession.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        terminalSessionId: userBSession.terminalSessionId,
      }),
    ])

    host.unregisterSocket('client_shared_attachment_a', USER_1, userASocket)
    host.unregisterSocket('client_shared_attachment_b', USER_2, userBSocket)
    shutdown()
  })

  test('cleans up detached user sessions after the detached TTL elapses', async () => {
    useFakeTimers()
    const { host, shutdown, socket, terminalRuntimeSessionId } = await startControlledTerminalRuntime()

    const first = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    expect(mockPtys).toHaveLength(1)

    host.unregisterSocket('client_a', USER_1, socket)
    await advanceTimersAndFlush(DETACHED_TTL_MS + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const socket2 = appRealtimeSocket()
    host.registerSocket('client_b', USER_1, socket2)
    setWorkspaceRuntimeId(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_b'))
    commitTerminalReadyProbe(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket2,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
        'req_list_after_detached_ttl',
        { clientId: 'client_b', userId: USER_1 },
      ),
    ).resolves.toMatchObject({ entries: [] })

    const recreatedSessionId = await createTerminalSession(host, 'client_b')
    const replacementAttach = await host.attach('client_b', USER_1, {
      terminalRuntimeSessionId: recreatedSessionId,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    expect(replacementAttach.ok).toBe(true)
    if (!first.ok || !replacementAttach.ok) return
    expect(replacementAttach.terminalRuntimeSessionId).not.toBe(first.terminalRuntimeSessionId)

    host.unregisterSocket('client_b', USER_1, socket2)
    shutdown()
  })

  test('after the controller goes offline, a sibling attachment auto-claims on attach (single-user)', async () => {
    // Device-switch scenario: A was the controller intent (from
    // create); A's socket closes, so A is no longer the effective
    // controller. B then attaches and auto-claims without explicit
    // takeover because no effective controller is present.
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    const created = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.terminalRuntimeSessionId

    host.unregisterSocket('client_a', USER_1, socketA)

    // B comes online and attaches — no explicit takeover needed
    // because A is no longer the effective controller.
    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_b', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 0,
      cols: 120,
      rows: 40,
    })
    expect(viewerAttach).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_b', status: 'connected' },
      canonicalSize: { cols: 120, rows: 40 },
    })

    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('a late-returning original controller stays a viewer once a sibling has claimed control (no grace restore)', async () => {
    // Controller intent is retained, but effective control is derived from
    // presence. If a sibling attachment
    // attaches while the original controller is offline, the sibling
    // claims control. When the original
    // controller eventually reconnects, it is a viewer — the
    // previous design's grace restore ("same clientId keeps control after
    // briefly going offline") does not apply. The sibling claimed through the
    // ordinary attach rule while there was no effective controller. Recovery
    // for A is an explicit takeover; ordinary input cannot mutate control.
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    const socketAReconnect = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    const created = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.terminalRuntimeSessionId
    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })
    mockPtys[0]?.emitData('ready')

    // A goes offline; B attaches and claims because no effective controller remains.
    host.unregisterSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)
    const bAttach = await host.attach('client_b', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 120,
      rows: 40,
    })
    expect(bAttach).toMatchObject({
      ok: true,
      controller: { clientId: 'client_b', status: 'connected' },
    })

    // A reconnects later. B still holds the controller role; A's attach must
    // NOT preempt B — A becomes a viewer.
    host.registerSocket('client_a', USER_1, socketAReconnect)
    const aReattach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    expect(aReattach).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      // A's view sees B still in control.
      controller: { clientId: 'client_b', status: 'connected' },
    })

    // A's write is rejected by the server-side controller check. The client
    // also drops viewer input locally, but it is not an authority boundary.
    const aWrite = await host.write('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      data: 'ls\n',
    })
    expect(aWrite).toEqual({ status: 'rejected' })

    // B's write still works.
    const bWrite = await host.write('client_b', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      data: 'pwd\n',
    })
    expect(bWrite).toEqual({ status: 'accepted' })
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    // listSessions confirms the global view: B is the controller,
    // canonical geometry follows B (the attachment that claimed control).
    const sessions = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_b', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketAReconnect)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('viewer presence going offline leaves the current controller unchanged', async () => {
    // The previous revision had a grace sub-state that, on expiry,
    // would remove the offline viewer via `expireAttachment`.
    // The current model has no per-attachment grace — only the
    // detached TTL fires (after 24h), which is far longer than the
    // test. The relevant invariant is that an offline viewer
    // doesn't disturb the controller.
    useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    const created = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.terminalRuntimeSessionId

    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })

    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_b', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 120,
      rows: 40,
    })
    expect(viewerAttach.ok).toBe(true)

    host.unregisterSocket('client_b', USER_1, socketB)
    // The detached TTL is 24h — far longer than any grace we used
    // to have. Run a small tick to flush the socket-offline
    // microtask without firing any timer.
    await Promise.resolve()

    const sessionsAfterExpiry = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessionsAfterExpiry).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA)
    shutdown()
  })

  test('batches rapid writes into a single ordered pty write via the input queue', async () => {
    const { host, shutdown, socket, terminalRuntimeSessionId } = await startControlledTerminalRuntime()
    mockPtys[0]?.emitData('ready')

    const attach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    expect(attach.ok).toBe(true)

    const writes = ['c', 'l', 'e', 'a', 'r'].map((data) =>
      host.write('client_a', USER_1, { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, data }),
    )

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(0)

    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.write).toHaveBeenCalledWith('clear')
    await expect(Promise.all(writes)).resolves.toEqual(Array.from({ length: 5 }, () => ({ status: 'accepted' })))

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })
})
