// @vitest-environment jsdom

import {
  attachResult,
  createTerminalHost,
  descriptor,
  flushTerminalStart,
  hydrateManagedSession,
  resetTerminalSessionHarness,
  terminalCalls,
  terminalGeometryMocks,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalSession } from '#/web/terminal/components/TerminalSession.ts'

const xtermMocks = terminalXtermMocks()
const geometryMocks = terminalGeometryMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession hydration', () => {
  test('renders the recovery snapshot for a newly hydrated controller binding', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('term-remoteremoteremote001', {
        identityRevision: 1,
        snapshot: 'hydrated-screen',
        snapshotSeq: 5,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('hydrated-screen', expect.any(Function))
  })

  test('destroys the active controller view when full hydration changes binding ownership to viewer', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!

    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    await flushTerminalStart()

    expect(term.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
  })

  test('drops pending output from the retired binding before recovering a hydrated controller', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const oldTerm = xtermMocks.terminals[0]!
    oldTerm.write.mockClear()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'old-pending-output',
      seq: 1,
      processName: 'zsh',
    })
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('term-remoteremoteremote001', {
        identityRevision: 1,
        processName: 'node',
        snapshot: 'remote-screen',
        snapshotSeq: 5,
      }),
    )

    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    await flushTerminalStart()

    expect(oldTerm.dispose).toHaveBeenCalledOnce()
    expect(oldTerm.write).not.toHaveBeenCalled()
    expect(xtermMocks.terminals[1]!.write.mock.calls.map(([data]: unknown[]) => data)).toEqual(['remote-screen'])
  })

  test('keeps the active xterm when full hydration refreshes metadata for the same binding', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    term.write.mockClear()

    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushTerminalStart()

    expect(term.dispose).not.toHaveBeenCalled()
    expect(term.write).not.toHaveBeenCalled()
    expect(session.snapshot().processName).toBe('node')
  })
})
