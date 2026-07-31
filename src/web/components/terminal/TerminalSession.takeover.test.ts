// @vitest-environment jsdom

import {
  MockResizeObserver,
  attachResult,
  createTerminalHost,
  descriptor,
  flushTerminalStart,
  flushUntil,
  hydrateManagedSession,
  recoveryAttachResult,
  resetTerminalSessionHarness,
  takeoverResult,
  terminalCalls,
  terminalGeometryMocks,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalTakeoverResult } from '#/shared/terminal-types.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

const xtermMocks = terminalXtermMocks()
const geometryMocks = terminalGeometryMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession takeover and identity', () => {
  test('tracks server title changes separately from process name', async () => {
    const host = createTerminalHost()
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    session.handleServerTitle('~/Developer/goblin — npm run dev')

    expect(session.snapshot()).toMatchObject({
      phase: 'open',
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test('joins concurrent takeover callers to one server mutation', async () => {
    const takeoverResponse = Promise.withResolvers<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    const first = session.takeover()
    const second = session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length === 1)

    expect(session.snapshot().takeoverPending).toBe(true)
    takeoverResponse.resolve(takeoverResult('pty_session_1_aaaaaaaaa'))
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(terminalCalls.takeover).toHaveBeenCalledOnce()
    expect(session.snapshot().takeoverPending).toBeUndefined()
  })

  test.each([
    ['not-sent', 'unavailable', 'not-sent'],
    ['indeterminate', 'disconnected', 'indeterminate'],
  ] as const)('preserves %s realtime takeover failure at the UI boundary', async (_label, kind, delivery) => {
    const error = new ClientRealtimeRequestError('takeover transport failed', {
      kind,
      delivery,
      outageId: delivery === 'indeterminate' ? 1 : null,
    })
    terminalCalls.takeover.mockRejectedValueOnce(error)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    await expect(session.takeover()).rejects.toBe(error)

    expect(session.snapshot().takeoverPending).toBeUndefined()
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.takeover).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).not.toHaveBeenCalled()
  })

  test('rethrows unexpected takeover failures after retiring the candidate view', async () => {
    const error = new Error('unexpected takeover failure')
    terminalCalls.takeover.mockRejectedValueOnce(error)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    await expect(session.takeover()).rejects.toBe(error)

    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
  })

  test('fast-fails post-takeover presentation when attach delivery is indeterminate', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(takeoverResult('pty_session_1_aaaaaaaaa'))
    terminalCalls.attach.mockRejectedValueOnce(
      new ClientRealtimeRequestError('attach response was lost', {
        kind: 'disconnected',
        delivery: 'indeterminate',
        outageId: 1,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    await expect(session.takeover()).resolves.toBe(true)
    await flushTerminalStart()

    expect(session.snapshot()).toMatchObject({
      attachment: { role: 'controller' },
      presentationRecovery: 'failed',
    })
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledOnce()
  })

  test('ignores a takeover response superseded by a newer identity revision', async () => {
    const takeoverResponse = Promise.withResolvers<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    session.attach(host)

    const takeover = session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length === 1)
    const candidateTerm = xtermMocks.terminals[0]!
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    takeoverResponse.resolve(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        identityRevision: 1,
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )

    await expect(takeover).resolves.toBe(false)
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
    expect(candidateTerm.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).not.toHaveBeenCalled()
  })

  test('reports committed takeover success and admits one explicit attach-only retry after recovery fails', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(takeoverResult('pty_session_1_aaaaaaaaa'))
    terminalCalls.attach
      .mockResolvedValueOnce({ ok: false, message: 'recovery unavailable' })
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, { snapshot: 'restored after explicit retry' }),
      )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    await expect(session.takeover()).resolves.toBe(true)
    await flushTerminalStart()

    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(session.snapshot().presentationRecovery).toBe('failed')
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()

    const resizeObserver = MockResizeObserver.instances.at(-1)
    if (!resizeObserver) throw new Error('expected resize observer')
    resizeObserver.emit()
    await flushTerminalStart()
    expect(terminalCalls.attach).toHaveBeenCalledOnce()

    expect(session.retryPresentation()).toBe(true)
    expect(session.retryPresentation()).toBe(false)
    expect(session.snapshot().presentationRecovery).toBe('pending')
    await flushTerminalStart()

    expect(terminalCalls.takeover).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(session.snapshot().presentationRecovery).toBeUndefined()
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith(
      'restored after explicit retry',
      expect.any(Function),
    )
  })

  test('takeover response is the authoritative handshake (no realtime event required)', async () => {
    // After the takeover atomicity follow-up, the `terminal.takeover`
    // response carries role/controllerStatus/canonicalSize/phase
    // and is applied synchronously. The client does NOT have to
    // wait for a realtime `identity` event before painting the
    // post-takeover frame. A subsequent realtime event for the same
    // session is idempotent.
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 101, rows: 31 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushMicrotasks(2)
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    // No realtime identity event is needed; takeover and its recovery
    // attach commit the fitted controller view in one presentation.
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })

    // A later realtime identity event for the same session is a
    // benign re-apply — the runtime treats it as idempotent because
    // every field already matches.
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('takeover response starts a controller view for a hydrated viewer without a realtime event', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )
    terminalCalls.attach.mockResolvedValueOnce(
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
        snapshot: 'post-takeover-screen',
        snapshotSeq: 8,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    expect(xtermMocks.terminals).toHaveLength(0)

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals).toHaveLength(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('post-takeover-screen', expect.any(Function))
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('commits takeover after detach and lets the remounted view recover the authoritative controller', async () => {
    const takeoverResponse = Promise.withResolvers<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    terminalCalls.attach.mockResolvedValueOnce(
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
        terminalRuntimeGeneration: 1,
        snapshot: 'post-takeover recovery',
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    const takeover = session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length === 1)
    session.detach(host)
    session.attach(host)
    takeoverResponse.resolve(takeoverResult('pty_session_1_aaaaaaaaa'))
    await expect(takeover).resolves.toBe(true)
    await flushTerminalStart()

    expect(terminalCalls.takeover).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('post-takeover recovery', expect.any(Function))
  })

  test('mounting a hydrated unowned session attaches and auto-claims without manual takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'unowned',
      controllerStatus: 'none',
      canonicalSize: { cols: 120, rows: 40 },
    })

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals).toHaveLength(1)
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test.each([
    [
      'snapshot hydration',
      (session: TerminalSession) =>
        session.hydrate({
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          identityRevision: 1,
          phase: 'open',
          message: null,
          processName: 'zsh',
          canonicalTitle: null,
          role: 'unowned',
          controllerStatus: 'none',
          canonicalSize: { cols: 120, rows: 40 },
        }),
    ],
    [
      'realtime identity',
      (session: TerminalSession) =>
        session.handleIdentity({
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          identityRevision: 1,
          role: 'unowned',
          controllerStatus: 'none',
          canonicalSize: { cols: 120, rows: 40 },
        }),
    ],
  ] as const)('mounted viewer auto-attaches when %s reports unowned authority', async (_source, applyUnowned) => {
    terminalCalls.attach.mockResolvedValueOnce(
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
        snapshot: 'reclaimed-screen',
        snapshotSeq: 10,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)
    await flushTerminalStart()
    expect(terminalCalls.attach).not.toHaveBeenCalled()

    applyUnowned(session)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('reclaimed-screen', expect.any(Function))
  })

  test('commits fitted geometry in the first post-takeover recovery attach', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 132, rows: 43 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('post-takeover recovery attach propagates lifecycle phase into the runtime view', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
          controller: { clientId: 'client_local', status: 'connected' },
          phase: 'restarting',
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        phase: 'restarting',
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(session.snapshot().phase).toBe('restarting')
  })

  test('applies a newer realtime identity after takeover commits', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: null,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'unowned',
      controllerStatus: 'none',
      canonicalSize: { cols: 120, rows: 40 },
    })

    expect(session.snapshot().phase).toBe('open')
    expect(session.snapshot().attachment).toMatchObject({ role: 'unowned' })
  })

  test('starts a generation-fenced recovery attach when identity grants local control', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 101, rows: 31 },
    })
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })
})
