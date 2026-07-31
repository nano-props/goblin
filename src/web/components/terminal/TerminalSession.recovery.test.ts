// @vitest-environment jsdom

import {
  MockResizeObserver,
  attachResult,
  createTerminalHost,
  descriptor,
  flushTerminalStart,
  flushUntil,
  hydrateManagedSession,
  requiredWorkspaceLocator,
  resetTerminalSessionHarness,
  restartResult,
  startPendingFocusRequest,
  startSessionWithProgress,
  streamAttachResult,
  takeoverResult,
  terminalCalls,
  terminalGeometryMocks,
  terminalRect,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalAttachResult, TerminalRestartResult } from '#/shared/terminal-types.ts'
import { waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal-focus.ts'

const xtermMocks = terminalXtermMocks()
const geometryMocks = terminalGeometryMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession recovery, focus, and lifecycle presentation', () => {
  test('resets the terminal before replaying the snapshot', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'tail', snapshotSeq: 1 }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'tail'))

    expect(xtermMocks.terminals[0]!.reset).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('tail', expect.any(Function))
  })

  test('does not write realtime output already covered by the attached snapshot', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'prompt', snapshotSeq: 1 }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.write.mockClear()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'prompt',
      seq: 1,
      processName: 'zsh',
    })
    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'next',
      seq: 2,
      processName: 'zsh',
    })
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.write).toHaveBeenCalledWith('next', expect.any(Function))
  })

  test('batches terminal output writes on animation frames', async () => {
    const host = createTerminalHost()
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_otheraaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-999999999999999999999',
      data: 'ignored',
      seq: 1,
      processName: 'zsh',
    })
    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'first',
      seq: 1,
      processName: 'zsh',
    })
    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'second',
      seq: 2,
      processName: 'zsh',
    })

    // Controller mode: metadata doesn't change (processName was already set during attach)
    expect(notify).toHaveBeenCalledTimes(0)
    expect(xtermMocks.terminals[0]!.write).not.toHaveBeenCalled()
    await flushTerminalStart()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('firstsecond', expect.any(Function))
  })

  test('flushes matching terminal exits before the provider dismisses the session', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'before exit',
      seq: 1,
      processName: 'zsh',
    })
    expect(
      session.handleExit({
        terminalRuntimeSessionId: 'pty_session_otheraaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-999999999999999999999',
        workspaceId: requiredWorkspaceLocator('/repo'),
        workspaceRuntimeId: 'repo-runtime-1',
        tabsBeforeRetirement: null,
      }),
    ).toBe(false)
    expect(
      session.handleExit({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: requiredWorkspaceLocator('/repo'),
        workspaceRuntimeId: 'repo-runtime-1',
        tabsBeforeRetirement: null,
      }),
    ).toBe(true)
    session.dispose()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('before exit', expect.any(Function))
    expect(session.snapshot()).toMatchObject({ phase: 'open', message: null, processName: 'zsh', canonicalTitle: null })
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('keeps hydrated title when selecting a mirrored session', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    session.attach(host)

    expect(session.snapshot()).toMatchObject({
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
  })

  test('does not issue a direct close when disposed before restart reaches main', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    session.dispose()
    await flushTerminalStart()
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('does not issue a direct close for a stale restart response after disposal', async () => {
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    session.dispose()
    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('commits an in-flight restart once and remounts through generation recovery', async () => {
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    session.detach(host)
    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(terminalCalls.close).not.toHaveBeenCalled()
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
    })
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()

    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { terminalRuntimeGeneration: 2, snapshot: 'recovered generation 2' }),
    )
    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 2)
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledTimes(1)
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('recovered generation 2', expect.any(Function))
  })

  test('does not let a remounted view consume the origin prepared-attach stream', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'recovered generation 1',
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
    session.detach(host)
    session.attach(host)
    attach.resolve(streamAttachResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 2)
    await flushTerminalStart()

    expect(terminalCalls.attach.mock.calls).toEqual([
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 0,
          cols: 100,
          rows: 30,
        },
      ],
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        },
      ],
    ])
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(2)
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[1]!.write).toHaveBeenCalledWith('recovered generation 1', expect.any(Function))
  })

  test('waits an older operation before recovering exactly once to a future authoritative generation', async () => {
    const oldAttach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(oldAttach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 2,
        snapshot: 'generation 2 recovery',
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
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
    const pending = session.pendingAuthoritativeRuntimeBinding()
    expect(pending).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
    })
    expect(session.commitPendingAuthoritativeHydration(pending!)).toBe(true)

    oldAttach.resolve(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'obsolete generation 1 frame',
      }),
    )
    await flushTerminalStart()

    expect(terminalCalls.attach.mock.calls).toEqual([
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        },
      ],
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 2,
          cols: 100,
          rows: 30,
        },
      ],
    ])
    expect(xtermMocks.terminals[0]!.write).not.toHaveBeenCalledWith('obsolete generation 1 frame', expect.any(Function))
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('generation 2 recovery', expect.any(Function))
  })

  test.each(['negative response', 'not-sent transport rejection', 'indeterminate transport rejection'] as const)(
    'does not let a superseded recovery %s overwrite the newer authoritative recovery',
    async (settlement) => {
      const oldAttach = Promise.withResolvers<TerminalAttachResult>()
      const newAttach = Promise.withResolvers<TerminalAttachResult>()
      terminalCalls.attach.mockReturnValueOnce(oldAttach.promise).mockReturnValueOnce(newAttach.promise)
      const host = createTerminalHost()
      let session: TerminalSession
      session = new TerminalSession(descriptor, () => {
        const pending = session.pendingAuthoritativeRuntimeBinding()
        if (pending) session.commitPendingAuthoritativeHydration(pending)
      })
      hydrateManagedSession(session, {
        terminalRuntimeGeneration: 1,
        phase: 'open',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })

      session.attach(host)
      await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
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

      if (settlement === 'negative response') {
        oldAttach.resolve({ ok: false, message: 'error.unavailable' })
      } else if (settlement === 'not-sent transport rejection') {
        oldAttach.reject(
          new ClientRealtimeRequestError('attach was not sent', {
            kind: 'unavailable',
            delivery: 'not-sent',
            outageId: null,
          }),
        )
      } else {
        oldAttach.reject(
          new ClientRealtimeRequestError('attach response was lost', {
            kind: 'disconnected',
            delivery: 'indeterminate',
            outageId: 1,
          }),
        )
      }
      await flushUntil(() => terminalCalls.attach.mock.calls.length === 2)

      expect(session.currentRuntimeBinding()).toEqual({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 2,
      })
      expect(session.snapshot().presentationRecovery).toBe('pending')

      newAttach.resolve(
        attachResult('pty_session_1_aaaaaaaaa', {
          terminalRuntimeGeneration: 2,
          snapshot: 'generation 2 recovery',
        }),
      )
      await flushTerminalStart()

      expect(session.snapshot().presentationRecovery).toBeUndefined()
      expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('generation 2 recovery', expect.any(Function))
    },
  )

  test.each(['negative response', 'not-sent transport rejection', 'invalid controller geometry'] as const)(
    'publishes a restored recovery %s as one atomic metadata change',
    async (settlement) => {
      const attach = Promise.withResolvers<TerminalAttachResult>()
      terminalCalls.attach.mockReturnValueOnce(attach.promise)
      const host = createTerminalHost()
      const notify = vi.fn()
      const session = new TerminalSession(descriptor, notify)
      hydrateManagedSession(session, {
        terminalRuntimeGeneration: 1,
        phase: 'open',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })

      session.attach(host)
      await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
      expect(session.snapshot().presentationRecovery).toBe('pending')
      notify.mockClear()

      if (settlement === 'negative response') {
        attach.resolve({ ok: false, message: 'error.unavailable' })
      } else if (settlement === 'not-sent transport rejection') {
        attach.reject(
          new ClientRealtimeRequestError('attach was not sent', {
            kind: 'unavailable',
            delivery: 'not-sent',
            outageId: null,
          }),
        )
      } else {
        attach.resolve(
          attachResult('pty_session_1_aaaaaaaaa', {
            canonicalSize: { cols: 99, rows: 29 },
          }),
        )
      }
      await flushTerminalStart()

      expect(session.snapshot().presentationRecovery).toBe('failed')
      expect(notify).toHaveBeenCalledTimes(1)
    },
  )

  test('keeps a committed binding when presentation fails and recovers it on the next layout', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const firstTerm = xtermMocks.terminals[0]!
    const firstFit = xtermMocks.fitAddons[0]!
    attach.resolve(streamAttachResult('pty_session_1_aaaaaaaaa'))
    await waitForMicrotaskCondition(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 1)
    await waitForMicrotaskCondition(() => firstTerm.refresh.mock.calls.length === 1)
    firstFit.proposeDimensions.mockReturnValue(null)
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(0, 0))
    await flushTerminalStart()

    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(firstTerm.dispose).toHaveBeenCalledOnce()
    expect(session.snapshot().presentationRecovery).toBeUndefined()
    expect(host.querySelector('.goblin-managed-terminal-frame .xterm')).toBeNull()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(800, 400))
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'recovered committed binding',
      }),
    )
    const resizeObserver = MockResizeObserver.instances.at(-1)
    if (!resizeObserver) throw new Error('expected resize observer')
    resizeObserver.emit()
    expect(session.snapshot().presentationRecovery).toBe('pending')
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('recovered committed binding', expect.any(Function))
    expect(session.snapshot().presentationRecovery).toBeUndefined()
  })

  test('destroys the detached xterm and opens a fresh view on reattach', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const firstObserver = MockResizeObserver.instances[0]!
    const firstTerm = xtermMocks.terminals[0]!

    session.detach(host)
    expect(firstObserver.disconnect).toHaveBeenCalledTimes(1)
    expect(firstTerm.dispose).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()

    session.attach(host)
    await flushTerminalStart()
    expect(xtermMocks.terminals).toHaveLength(2)
    expect(host.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()
  })

  test('focus checks are derived from the xterm DOM host', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    xtermMocks.terminals[0]!.focus()
    expect(terminalHasKeyboardFocus()).toBe(true)
  })

  test('keeps disconnected focus pending and accepts its retry after the view attaches', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    const request = { isCurrent: () => true, onSettled: settled }

    expect(session.focus(request)).toBe(false)
    expect(settled).not.toHaveBeenCalled()
    session.attach(host)
    expect(session.focus(request)).toBe(true)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!

    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    await flushTerminalStart()

    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
  })

  test('settles a focus lease when its initial currency check throws', () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()
    session.attach(host)

    expect(() =>
      session.focus({
        isCurrent: () => {
          throw new Error('focus currency check failed')
        },
        onSettled: settled,
      }),
    ).toThrow('focus currency check failed')
    expect(settled).toHaveBeenCalledOnce()
  })

  test('settles a focus lease when xterm focus fails during presentation', async () => {
    const { term, settled } = await startPendingFocusRequest()
    term.focus.mockImplementationOnce(() => {
      throw new Error('focus failed')
    })
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.dispose).toHaveBeenCalledOnce()
  })

  test('releases a pending focus lease when the hidden presentation detaches', async () => {
    const { host, session, term, settled } = await startPendingFocusRequest()
    session.detach(host)
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.focus).not.toHaveBeenCalled()
  })

  test('releases a pending focus lease when controller ownership changes to viewer', async () => {
    const { session, term, settled } = await startPendingFocusRequest()
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.focus).not.toHaveBeenCalled()
  })

  test('releases a pending focus lease when an authoritative binding supersedes the candidate', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.attach(host)
    expect(session.focus({ isCurrent: () => true, onSettled: settled })).toBe(true)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
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
    const pending = session.pendingAuthoritativeRuntimeBinding()
    if (!pending) throw new Error('expected pending authoritative binding')
    expect(session.commitPendingAuthoritativeHydration(pending)).toBe(true)
    attach.resolve(streamAttachResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.focus).not.toHaveBeenCalled()
  })

  test('applies terminal theme and updates when the app theme changes', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    const term = xtermMocks.terminals[0]!
    const frame = host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')
    expect(term.options.theme).toMatchObject({ background: '#ffffff', foreground: '#1d1d1f' })
    expect(frame?.style.background).toBe('rgb(255, 255, 255)')
    expect(frame?.style.getPropertyValue('--goblin-terminal-background')).toBe('#ffffff')

    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve()

    expect(term.options.theme).toMatchObject({ background: '#111113', foreground: '#f5f5f7' })
    expect(frame?.style.getPropertyValue('--goblin-terminal-background')).toBe('#111113')
  })

  test('progress state appears in snapshot and clears on state 0', async () => {
    const { session, notify, progressAddon } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    expect(notify).toHaveBeenCalledWith('snapshot')

    notify.mockClear()
    progressAddon.emitProgress(0, 0)
    expect(session.snapshot().progress).toBeUndefined()
    expect(notify).toHaveBeenCalledWith('snapshot')
  })

  test('progress state is cleared on restart', async () => {
    const { session } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })

    session.restart()
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot().progress).toBeUndefined()
  })

  test('progress state is cleared and published on detach', async () => {
    const { host, session, notify } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    notify.mockClear()

    session.detach(host)

    expect(session.snapshot().progress).toBeUndefined()
    expect(notify.mock.calls).toEqual([['snapshot']])
  })

  describe('identity and lifecycle presentation contract', () => {
    test('realtime lifecycle update overrides a prior takeover response phase', async () => {
      terminalCalls.attach.mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      terminalCalls.takeover.mockResolvedValueOnce(
        takeoverResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_local', status: 'connected' },
          phase: 'open',
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
      expect(session.snapshot().phase).toBe('open')

      session.handleLifecycle({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        phase: 'restarting',
        message: null,
      })
      expect(session.snapshot().phase).toBe('restarting')
    })

    test('preserves the controller xterm across identity and transitional lifecycle updates', async () => {
      const host = createTerminalHost()
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const xtermBefore = host.querySelector('.goblin-managed-terminal-host .xterm')
      expect(xtermBefore).not.toBeNull()
      expect(session.snapshot().attachment).toMatchObject({ role: 'controller' })

      session.handleIdentity({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })

      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBe(xtermBefore)

      session.handleLifecycle({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        phase: 'opening',
        message: null,
      })
      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBe(xtermBefore)
      expect(session.snapshot().phase).toBe('opening')
    })

    test('realtime viewer identity tears down the controller xterm', async () => {
      const host = createTerminalHost()
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()

      session.handleIdentity({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })

      expect(session.snapshot().attachment).toMatchObject({ role: 'viewer' })
      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    })
  })
})
