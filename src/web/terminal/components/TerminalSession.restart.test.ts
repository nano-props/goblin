// @vitest-environment jsdom

import {
  MockResizeObserver,
  attachResult,
  createTerminalHost,
  descriptor,
  emitSessionOutput,
  flushTerminalStart,
  flushUntil,
  hydrateManagedSession,
  resetTerminalSessionHarness,
  restartResult,
  startSessionWithProgress,
  terminalCalls,
  terminalGeometryMocks,
  terminalRect,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalRestartResult } from '#/shared/terminal-types.ts'
import { waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { TerminalSession } from '#/web/terminal/components/TerminalSession.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal/focus.ts'

const xtermMocks = terminalXtermMocks()
const geometryMocks = terminalGeometryMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession restart and resynchronization', () => {
  test('restarts the current runtime binding without issuing a second attach', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
  })

  test('keeps a replacement xterm hidden until the restart stream presentation commits', async () => {
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')

    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 2)
    emitSessionOutput(session, 2)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(xtermMocks.terminals.at(-1)!.reset).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()
  })

  test('rejects a duplicate restart while the admitted request is in flight', async () => {
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)

    expect(terminalCalls.restart).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals).toHaveLength(2)
    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 2)
    emitSessionOutput(session, 2)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')
  })

  test('continues an admitted restart when a zero-sized host becomes measurable', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    terminalCalls.restart.mockClear()

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(0, 0))
    session.restart()
    await flushTerminalStart()
    expect(terminalCalls.restart).not.toHaveBeenCalled()

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(800, 400))
    const resizeObserver = MockResizeObserver.instances[0]
    if (!resizeObserver) throw new Error('expected resize observer')
    resizeObserver.emit()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)

    expect(terminalCalls.restart).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
  })

  test('does not let an old xterm write callback block a replacement presentation', async () => {
    xtermMocks.deferWriteCallbacks(true)
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'old screen' }))
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await waitForMicrotaskCondition(() => xtermMocks.terminals[0]?.write.mock.calls.length === 1)

    xtermMocks.deferWriteCallbacks(false)
    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    await flushUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 2)
    emitSessionOutput(session, 2)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(xtermMocks.terminals).toHaveLength(2)
    expect(xtermMocks.terminals[1]!.refresh).toHaveBeenCalledWith(0, 29)
    xtermMocks.flushDeferredWriteCallbacks()
  })

  test('keeps the server session addressable when restart fails', async () => {
    terminalCalls.restart.mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()

    expect(session.currentTerminalRuntimeSessionId()).toBeNull()
    expect(session.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(session.snapshot()).toMatchObject({
      phase: 'error',
      message: 'error.spawn-failed',
      processName: 'zsh',
      canonicalTitle: null,
      attachment: { role: 'controller' },
    })
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('fast-fails an indeterminate restart without replaying it', async () => {
    terminalCalls.restart.mockRejectedValueOnce(
      new ClientRealtimeRequestError('restart response was lost', {
        kind: 'disconnected',
        delivery: 'indeterminate',
        outageId: 1,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledOnce()
    expect(session.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(session.snapshot().presentationRecovery).toBe('failed')
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
  })

  test('resumes presentation from a new authoritative generation without restoring focus', async () => {
    terminalCalls.restart.mockRejectedValueOnce(
      new ClientRealtimeRequestError('restart response was lost', {
        kind: 'disconnected',
        delivery: 'indeterminate',
        outageId: 1,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { terminalRuntimeGeneration: 2, snapshot: 'new screen' }),
    )

    const settled = vi.fn()
    session.focus({ isCurrent: () => true, onSettled: settled })
    session.restart()
    await flushTerminalStart()
    expect(session.snapshot().presentationRecovery).toBe('failed')

    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 2)
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().presentationRecovery).toBeUndefined()
    expect(xtermMocks.terminals.at(-1)!.focus).not.toHaveBeenCalled()
    expect(settled).toHaveBeenCalledOnce()
  })

  test('retries a failed restart from the retained generation and publishes exactly old plus one', async () => {
    terminalCalls.restart
      .mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
      .mockResolvedValueOnce(restartResult('pty_session_1_aaaaaaaaa'))
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()
    expect(session.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledTimes(2)
    expect(terminalCalls.restart.mock.calls.map(([input]) => input.terminalRuntimeGeneration)).toEqual([1, 1])
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
    })
  })

  test('retries a failed prepared attach through attach instead of restart', async () => {
    terminalCalls.attach.mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(session.snapshot()).toMatchObject({
      phase: 'error',
      message: 'error.spawn-failed',
      processName: 'zsh',
      canonicalTitle: null,
      attachment: { role: 'unowned' },
    })

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('open')
  })

  test('does not retain an unscoped focus request while presentation is pending', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    expect(session.focus()).toBe(false)
    await flushTerminalStart()

    expect(xtermMocks.terminals[0]!.focus).not.toHaveBeenCalled()
  })

  test('rebuilds a connected view as one focus and transient-state transaction', async () => {
    const { session, notify, term: firstTerm } = await startSessionWithProgress()
    session.focus()
    expect(terminalHasKeyboardFocus()).toBe(true)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    notify.mockClear()

    session.resynchronizeConnectedView()

    expect(firstTerm.dispose).toHaveBeenCalledOnce()
    expect(session.snapshot().progress).toBeUndefined()
    expect(notify).toHaveBeenCalledWith('snapshot')
    await flushTerminalStart()

    const rebuiltTerm = xtermMocks.terminals.at(-1)!
    expect(rebuiltTerm).not.toBe(firstTerm)
    expect(rebuiltTerm.focus).toHaveBeenCalledOnce()
    expect(terminalHasKeyboardFocus()).toBe(true)
  })

  test('clears and publishes transient state for a connected viewer during resynchronization', async () => {
    const { host, session, notify } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    notify.mockClear()

    session.resynchronizeConnectedView()

    expect(session.snapshot().progress).toBeUndefined()
    expect(notify).toHaveBeenCalledWith('snapshot')
    expect(terminalCalls.attach).toHaveBeenCalledOnce()
  })

})
