// @vitest-environment jsdom

import {
  attachResult,
  descriptor,
  flushTerminalStart,
  flushUntil,
  hydrateManagedSession,
  resetTerminalSessionHarness,
  setNextTerminalIdentityRevision,
  startOpenControllerSession,
  terminalCalls,
  terminalGeometryMocks,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalResizeResult } from '#/shared/terminal-types.ts'
import { flushMicrotasks, waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { TerminalSession } from '#/web/terminal/components/TerminalSession.ts'

const xtermMocks = terminalXtermMocks()
const geometryMocks = terminalGeometryMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession resize', () => {
  test.each([
    'server rejection',
    'transport failure',
    'synchronous transport failure',
    'session mismatch',
    'generation mismatch',
    'canonical size mismatch',
  ] as const)('rebuilds the view from an authoritative snapshot after a resize %s', async (failure) => {
    if (failure === 'server rejection') {
      terminalCalls.resize.mockResolvedValueOnce({ ok: false, message: 'error.unavailable' })
    } else if (failure === 'transport failure') {
      terminalCalls.resize.mockRejectedValueOnce(new Error('resize failed'))
    } else if (failure === 'synchronous transport failure') {
      terminalCalls.resize.mockImplementationOnce(() => {
        throw new Error('resize bridge unavailable')
      })
    } else {
      terminalCalls.resize.mockResolvedValueOnce({
        ok: true,
        terminalRuntimeSessionId:
          failure === 'session mismatch' ? 'pty_session_2_bbbbbbbbb' : 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: failure === 'generation mismatch' ? 2 : 1,
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: failure === 'canonical size mismatch' ? { cols: 102, rows: 32 } : { cols: 101, rows: 31 },
      })
    }
    const { session, term: invalidatedTerm } = await startOpenControllerSession()
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        snapshot: 'recovered after resize',
        snapshotSeq: 1,
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )

    invalidatedTerm.resize(101, 31)
    await flushMicrotasks(2)
    await flushTerminalStart()

    expect(terminalCalls.resize).toHaveBeenCalledOnce()
    expect(terminalCalls.resize).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 101,
      rows: 31,
    })
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(invalidatedTerm.dispose).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('recovered after resize', expect.any(Function))
    expect(session.snapshot().phase).toBe('open')
  })

  test('serializes resize commits and keeps only the latest proposal while one is in flight', async () => {
    const firstResize = Promise.withResolvers<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(firstResize.promise)
    const { term } = await startOpenControllerSession()

    term.resize(101, 31)
    await waitForMicrotaskCondition(() => terminalCalls.resize.mock.calls.length === 1)
    term.resize(102, 32)
    term.resize(103, 33)
    await flushMicrotasks(2)
    expect(terminalCalls.resize).toHaveBeenCalledOnce()

    firstResize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_local', status: 'connected' },
      canonicalSize: { cols: 101, rows: 31 },
    })
    setNextTerminalIdentityRevision(1)
    await waitForMicrotaskCondition(() => terminalCalls.resize.mock.calls.length === 2)

    expect(terminalCalls.resize).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 103,
      rows: 33,
    })
    await flushTerminalStart()
    expect(terminalCalls.resize).toHaveBeenCalledTimes(2)
  })

  test('does not let a stale resize acknowledgement regress newer controller geometry', async () => {
    const resize = Promise.withResolvers<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(resize.promise)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    const { term } = await startOpenControllerSession(session)

    term.resize(101, 31)
    await flushUntil(() => terminalCalls.resize.mock.calls.length === 1)
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    notify.mockClear()
    resize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_local', status: 'connected' },
      canonicalSize: { cols: 101, rows: 31 },
    })
    await flushTerminalStart()

    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    expect(notify).not.toHaveBeenCalled()
  })

  test('ignores a stale resize acknowledgement without rebuilding the current controller view', async () => {
    const resize = Promise.withResolvers<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(resize.promise)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    const { term } = await startOpenControllerSession(session)

    term.resize(101, 31)
    await flushUntil(() => terminalCalls.resize.mock.calls.length === 1)
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    resize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_local', status: 'connected' },
      canonicalSize: { cols: 101, rows: 31 },
    })
    await flushTerminalStart()

    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(term.dispose).not.toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(1)
  })
})
