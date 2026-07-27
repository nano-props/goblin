import { SerializeAddon } from '@xterm/addon-serialize'
import { describe, expect, test, vi } from 'vitest'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import {
  CLIENT_ID,
  SCOPE,
  USER_ID,
  createAlwaysOnlineManager,
  createDeferredPtySupervisor,
  createSession,
  createWorkspaceRuntimeRetentionHost,
  noRetirementTabsSnapshot,
  ptySpawnSuccess,
} from '#/server/test-utils/terminal-session-manager.ts'

describe('TerminalSessionManager controller and frame lifecycle', () => {
  test('does not commit a replacement controller when its PTY resize fails', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const onlineClients = new Set([CLIENT_ID])
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn(), onIdentity },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    onlineClients.delete(CLIENT_ID)
    manager.handleClientPresenceChanged(USER_ID, CLIENT_ID, true)
    onIdentity.mockClear()
    vi.mocked(supervisor.resize).mockImplementationOnce(() => {
      throw new Error('resize failed')
    })

    onlineClients.add('client-replacement')
    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        100,
        30,
        'client-replacement',
      ),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })

    expect(onIdentity).not.toHaveBeenCalled()
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: null,
      canonicalSize: { cols: 80, rows: 24 },
    })
  })

  test('serializes concurrent recovery attachments into one controller decision', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onlineClients = new Set([CLIENT_ID, 'client-b', 'client-c'])
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn(), onIdentity: vi.fn() },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        80,
        24,
        'client-b',
      ),
    ).resolves.toMatchObject({ ok: true, frame: 'snapshot', controller: { clientId: CLIENT_ID } })
    manager.expireClientAttachments(USER_ID, CLIENT_ID)

    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    const controllerAttach = manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      'client-b',
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledTimes(1))
    const viewerAttach = manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      'client-c',
    )

    nativeResize.resolve(true)
    await expect(controllerAttach).resolves.toMatchObject({
      ok: true,
      frame: 'snapshot',
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 100, rows: 30 },
    })
    await expect(viewerAttach).resolves.toMatchObject({
      ok: true,
      frame: 'snapshot',
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(supervisor.resize).toHaveBeenCalledTimes(1)
  })

  test('orders concurrent takeover responses and never publishes a regressive identity', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      'client-b',
    )
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      'client-c',
    )
    onIdentity.mockClear()

    const firstResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await firstResize.promise)
    const takeoverB = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      'client-b',
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledTimes(1))
    const takeoverC = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      'client-c',
    )

    firstResize.resolve(true)
    await expect(takeoverB).resolves.toMatchObject({
      ok: true,
      identityRevision: 2,
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 100, rows: 30 },
    })
    await expect(takeoverC).resolves.toMatchObject({
      ok: true,
      identityRevision: 4,
      controller: { clientId: 'client-c' },
      canonicalSize: { cols: 120, rows: 40 },
    })
    const publishedIdentityRevisions = onIdentity.mock.calls.map(([, event]) => event.identityRevision)
    expect(publishedIdentityRevisions).toHaveLength(2)
    expect(publishedIdentityRevisions).toEqual([...publishedIdentityRevisions].sort((a, b) => a - b))
    expect(publishedIdentityRevisions.at(-1)).toBe(4)
    expect(onIdentity).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({
        identityRevision: 4,
        controller: expect.objectContaining({ clientId: 'client-c' }),
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
  })

  test('rejects an old controller resize queued behind a committed takeover', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      'client-b',
    )

    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      'client-b',
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledTimes(1))
    const staleResize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )

    nativeResize.resolve(true)
    await expect(takeover).resolves.toMatchObject({
      ok: true,
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 120, rows: 40 },
    })
    await expect(staleResize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(supervisor.resize).toHaveBeenCalledTimes(1)
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 120, rows: 40 },
    })
  })

  test('does not let a stale takeover acknowledgement mutate a replacement binding', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    const viewerClientId = 'client-stale-takeover'
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      viewerClientId,
    )
    onIdentity.mockClear()

    const oldResizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await oldResizeAcknowledged.promise)
    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      viewerClientId,
    )
    await vi.waitFor(() =>
      expect(supervisor.resize).toHaveBeenCalledWith({ ptySessionId: 'pty_initial_123456' }, 120, 40),
    )

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_after_stale_takeover_123456'))
    await expect(restart).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: created.terminalRuntimeGeneration + 1,
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(onIdentity).toHaveBeenCalledOnce()
    expect(onIdentity).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({
        terminalRuntimeGeneration: created.terminalRuntimeGeneration + 1,
        identityRevision: 0,
        controller: expect.objectContaining({ clientId: CLIENT_ID }),
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )
    onIdentity.mockClear()

    oldResizeAcknowledged.resolve(true)
    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      terminalRuntimeGeneration: created.terminalRuntimeGeneration + 1,
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(onIdentity).not.toHaveBeenCalled()
  })

  test('publishes acknowledged native geometry when controller presence expires during resize', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onlineClients = new Set([CLIENT_ID])
    const onIdentity = vi.fn()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn(), onIdentity },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)

    const resize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    onlineClients.delete(CLIENT_ID)
    manager.handleClientPresenceChanged(USER_ID, CLIENT_ID, true)
    nativeResize.resolve(true)

    await expect(resize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: null,
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(onIdentity).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ controller: null, canonicalSize: { cols: 100, rows: 30 } }),
    )
  })

  test('publishes acknowledged geometry and rejects only the unavailable recovery snapshot', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    onIdentity.mockClear()
    vi.spyOn(SerializeAddon.prototype, 'serialize').mockImplementationOnce(() => {
      throw new Error('serializer unavailable')
    })

    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        112,
        37,
        CLIENT_ID,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(onIdentity).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ canonicalSize: { cols: 112, rows: 37 } }),
    )

    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        112,
        37,
        CLIENT_ID,
      ),
    ).resolves.toMatchObject({ ok: true, frame: 'snapshot', canonicalSize: { cols: 112, rows: 37 } })
  })

  test('rejects an acknowledged resize after close admission while retaining the physical geometry fact', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    onIdentity.mockClear()
    const resizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockReturnValueOnce(resizeAcknowledged.promise)
    const killAcknowledged = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await killAcknowledged.promise)

    const resize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      112,
      37,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    resizeAcknowledged.resolve(true)
    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)

    await expect(resize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(onIdentity).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ canonicalSize: { cols: 112, rows: 37 } }),
    )
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 112, rows: 37 },
    })

    killAcknowledged.resolve()
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
  })

  test('does not commit takeover control after close admission', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)
    const viewerClientId = 'client-takeover-closing'
    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        80,
        24,
        viewerClientId,
      ),
    ).resolves.toMatchObject({ ok: true, frame: 'snapshot' })
    const resizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockReturnValueOnce(resizeAcknowledged.promise)
    const killAcknowledged = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await killAcknowledged.promise)

    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      viewerClientId,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    resizeAcknowledged.resolve(true)
    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)

    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 120, rows: 40 },
    })

    killAcknowledged.resolve()
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
  })

  test('does not resurrect a client that expires while takeover geometry is committing', async () => {
    const supervisor = createDeferredPtySupervisor()
    const viewerClientId = 'client-takeover-expiring'
    const onlineClients = new Set([CLIENT_ID, viewerClientId])
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn() },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      viewerClientId,
    )
    const resizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockReturnValueOnce(resizeAcknowledged.promise)

    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      viewerClientId,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    onlineClients.delete(viewerClientId)
    manager.expireClientAttachments(USER_ID, viewerClientId)
    resizeAcknowledged.resolve(true)

    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 100, rows: 30 },
    })
    await expect(
      manager.takeoverSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        100,
        30,
        viewerClientId,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })
  })

  test('publishes acknowledged native geometry without granting takeover after the requester goes offline', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onlineClients = new Set([CLIENT_ID, 'client-b'])
    const onIdentity = vi.fn()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn(), onIdentity },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      'client-b',
    )
    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    onIdentity.mockClear()

    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      'client-b',
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    onlineClients.delete('client-b')
    manager.handleClientPresenceChanged(USER_ID, 'client-b', true)
    nativeResize.resolve(true)

    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 120, rows: 40 },
    })
    expect(onIdentity).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({
        controller: expect.objectContaining({ clientId: CLIENT_ID }),
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
  })
})
