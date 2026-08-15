// @vitest-environment jsdom

import {
  attachResult,
  createTerminalHost,
  descriptor,
  flushTerminalStart,
  hydrateManagedSession,
  resetTerminalSessionHarness,
  restartResult,
  terminalCalls,
  terminalGeometryMocks,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { TerminalSession } from '#/web/terminal/components/TerminalSession.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const geometryMocks = terminalGeometryMocks()
const xtermMocks = terminalXtermMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession presentation wait disclosure', () => {
  test('projects font loading while that local operation is pending', async () => {
    const preload = Promise.withResolvers<void>()
    geometryMocks.preloadTerminalFont.mockReturnValueOnce(preload.promise)
    const session = openControllerSession()
    session.attach(createTerminalHost())

    await waitForMicrotaskCondition(() => geometryMocks.preloadTerminalFont.mock.calls.length === 1)
    expect(session.snapshot().presentationWait).toBe('font-load')
    expect(terminalCalls.attach).not.toHaveBeenCalled()

    preload.resolve()
    await flushTerminalStart()
    expect(session.snapshot().presentationWait).toBeUndefined()
  })

  test('projects each serial operation after font loading until rendering completes', async () => {
    const attach = Promise.withResolvers<ReturnType<typeof attachResult>>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const notify = vi.fn()
    const session = openControllerSession(notify)
    session.attach(createTerminalHost())

    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    expect(session.snapshot().presentationWait).toBe('server-sync')
    expect(notify).toHaveBeenLastCalledWith('snapshot')

    const term = xtermMocks.terminals[0]!
    xtermMocks.deferWriteCallbacks(true)
    attach.resolve(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'restored prompt' }))
    await waitForMicrotaskCondition(() => term.write.mock.calls.length === 1)
    expect(session.snapshot().presentationWait).toBe('snapshot-replay')

    xtermMocks.deferWriteCallbacks(false)
    xtermMocks.flushDeferredWriteCallbacks()
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)
    expect(session.snapshot().presentationWait).toBe('viewport-render')

    await flushTerminalStart()
    expect(session.snapshot().presentationWait).toBeUndefined()
  })

  test('distinguishes a restart request from an attach synchronization', async () => {
    const session = openControllerSession()
    session.attach(createTerminalHost())
    await flushTerminalStart()

    const restart = Promise.withResolvers<ReturnType<typeof restartResult>>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    session.restart()

    await waitForMicrotaskCondition(() => terminalCalls.restart.mock.calls.length === 1)
    expect(session.snapshot().presentationWait).toBe('server-restart')

    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()
    expect(session.snapshot().presentationWait).toBeUndefined()
  })
})

function openControllerSession(notify = vi.fn()): TerminalSession {
  const session = new TerminalSession(descriptor, notify)
  hydrateManagedSession(session, {
    terminalRuntimeGeneration: 1,
    phase: 'open',
    role: 'controller',
    controllerStatus: 'connected',
    canonicalSize: { cols: 100, rows: 30 },
  })
  return session
}
