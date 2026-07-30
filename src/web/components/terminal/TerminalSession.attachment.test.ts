// @vitest-environment jsdom

import {
  MockResizeObserver,
  attachResult,
  createTerminalHost,
  descriptor,
  emitSessionOutput,
  flushFontRefit,
  flushTerminalStart,
  flushUntil,
  hostOpenExternalUrl,
  hydrateManagedSession,
  mockFonts,
  optionArrow,
  resetTerminalSessionHarness,
  startHiddenFreshStreamPresentation,
  startOpenControllerSession,
  startPendingFocusRequest,
  streamAttachResult,
  terminalCalls,
  terminalGeometryMocks,
  terminalRect,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalAttachResult } from '#/shared/terminal-types.ts'
import { flushMicrotasks, waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { terminalLog } from '#/web/logger.ts'
import { keyboardEventForTest } from '#/web/test-utils/keyboard-event.ts'

const xtermMocks = terminalXtermMocks()
const geometryMocks = terminalGeometryMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession attachment and presentation', () => {
  test('opens xterm and attaches the primary terminal session with fitted dimensions', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(host.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals[0]!.options.minimumContrastRatio).toBe(4.5)
    expect(xtermMocks.terminals[0]!.options.cursorStyle).toBe('bar')
    expect(terminalCalls.restart).not.toHaveBeenCalled()
  })

  test('does not open xterm until authoritative hydration supplies an addressable binding', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())

    session.attach(host)
    await Promise.resolve()

    expect(xtermMocks.terminals).toHaveLength(0)
    expect(terminalCalls.attach).not.toHaveBeenCalled()

    hydrateManagedSession(session)
    await flushTerminalStart()

    expect(xtermMocks.terminals).toHaveLength(1)
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 100,
      rows: 30,
    })
  })

  test('bounds fitted geometry at the shared protocol limit before the first attach', async () => {
    xtermMocks.setProposedDimensions({ cols: 700, rows: 400 })
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { canonicalSize: { cols: 500, rows: 300 } }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    await flushTerminalStart()
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(xtermMocks.terminals[0]).toMatchObject({ cols: 500, rows: 300 })
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 500,
      rows: 300,
    })
  })

  test('keeps the fitted xterm hidden until its full viewport render completes', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    expect(term.refresh).not.toHaveBeenCalled()

    attach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    await flushTerminalStart()

    expect(term.refresh).toHaveBeenCalledWith(0, 29)
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
  })

  test('never reveals a fitted xterm superseded while its final render is pending', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushTerminalStart()

    expect(term.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
  })

  test('remeasures a pending presentation before reveal and recovers at the current layout', async () => {
    const firstAttach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(firstAttach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        identityRevision: 1,
        canonicalSize: { cols: 90, rows: 25 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    const fitAddon = xtermMocks.fitAddons[0]!
    firstAttach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)

    fitAddon.proposeDimensions.mockReturnValue({ cols: 90, rows: 25 })
    await flushTerminalStart()
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(1, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 90,
      rows: 25,
    })
    expect(term.cols).toBe(90)
    expect(term.rows).toBe(25)
  })

  test('fails a controller attach response that did not commit its requested geometry', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        canonicalSize: { cols: 99, rows: 29 },
      }),
    )
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    expect(warnSpy).toHaveBeenCalledWith(
      'terminal presentation failed',
      expect.objectContaining({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        error: expect.objectContaining({
          message: 'terminal start response did not commit the requested controller geometry',
        }),
      }),
    )
    warnSpy.mockRestore()
  })

  test('keeps the fresh xterm intact and renders realtime output from sequence 1', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = createTerminalHost()
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })

    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    expect(notify).toHaveBeenCalledWith('projection-delta-revision', 1)
    expect(term.reset).not.toHaveBeenCalled()
    expect(term.write).not.toHaveBeenCalled()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: descriptor.terminalSessionId,
      data: 'prompt',
      seq: 1,
      processName: 'zsh',
    })
    await flushTerminalStart()

    expect(term.reset).not.toHaveBeenCalled()
    expect(term.write).toHaveBeenCalledWith('prompt', expect.any(Function))
  })

  test('rebuilds a visible terminal from the authoritative snapshot after an append render failure', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    const failedTerm = xtermMocks.terminals[0]!
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        snapshot: 'authoritative screen after render failure',
        snapshotSeq: 1,
      }),
    )
    failedTerm.write.mockImplementationOnce(() => {
      throw new Error('xterm write buffer overflow')
    })

    emitSessionOutput(session, 1, 'live output that failed to render')
    await flushUntil(() => xtermMocks.terminals.length === 2)
    await flushTerminalStart()

    expect(failedTerm.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(xtermMocks.terminals[1]!.write).toHaveBeenCalledWith(
      'authoritative screen after render failure',
      expect.any(Function),
    )
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
  })

  test('transfers automatic focus when a fresh stream presentation is complete', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const { host, session, term, settled } = await startPendingFocusRequest()
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    term.emitUserData('typed-before-render')
    await flushMicrotasks(2)
    expect(terminalCalls.write).not.toHaveBeenCalled()

    await flushTerminalStart()

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(term.write).not.toHaveBeenCalled()
    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()

    emitSessionOutput(session, 1, 'prompt')
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('prompt', expect.any(Function))
    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
    term.emitUserData('l')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'l',
    })
  })

  test('drops an automatic focus transfer whose presentation lease expires before presentation', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    let focusIsCurrent = true
    const { host, term, settled } = await startPendingFocusRequest(() => focusIsCurrent)
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)
    focusIsCurrent = false

    await flushTerminalStart()

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).toHaveBeenCalledOnce()
  })

  test('queues fresh output while hidden and flushes it in order after presentation', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()

    emitSessionOutput(session, 1, 'first output')
    emitSessionOutput(session, 1, ' then second output', 2)
    await Promise.resolve()

    expect(term.write).not.toHaveBeenCalled()
    expect(frame?.style.visibility).toBe('hidden')

    term.emitRender()
    await waitForMicrotaskCondition(() => term.write.mock.calls.length === 1)

    expect(frame?.style.visibility).toBe('')
    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.write).toHaveBeenCalledWith('first output then second output', expect.any(Function))
    await flushTerminalStart()
    expect(term.write).toHaveBeenCalledTimes(1)
  })

  test('renders output that arrives after fresh stream presentation without another viewport refresh', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()

    expect(frame?.style.visibility).toBe('hidden')
    term.emitRender()
    await waitForMicrotaskCondition(() => frame?.style.visibility === '')

    emitSessionOutput(session, 1, 'later output')
    await flushTerminalStart()

    expect(frame?.style.visibility).toBe('')
    expect(term.write).toHaveBeenCalledWith('later output', expect.any(Function))
    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.refresh).toHaveBeenCalledTimes(1)
  })

  test('rebuilds from the authoritative snapshot when queued fresh output cannot render after presentation', async () => {
    const { host, session, term: failedTerm } = await startHiddenFreshStreamPresentation()
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        snapshot: 'authoritative screen after pending render failure',
        snapshotSeq: 1,
      }),
    )
    failedTerm.write.mockImplementationOnce(() => {
      throw new Error('xterm write buffer overflow')
    })

    emitSessionOutput(session, 1, 'pending live output')
    failedTerm.emitRender()
    await flushUntil(() => xtermMocks.terminals.length === 2)
    await flushTerminalStart()

    expect(failedTerm.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(xtermMocks.terminals[1]!.write).toHaveBeenCalledWith(
      'authoritative screen after pending render failure',
      expect.any(Function),
    )
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
  })

  test('defers fresh-output protocol replies until the terminal is presented', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()
    term.write.mockImplementationOnce((_data: string, callback?: () => void) => {
      term.emitData('\x1b[1;1R')
      if (callback) queueMicrotask(callback)
    })

    emitSessionOutput(session, 1, '\x1b[6n')

    expect(frame?.style.visibility).toBe('hidden')
    expect(term.write).not.toHaveBeenCalled()
    expect(terminalCalls.write).not.toHaveBeenCalled()

    term.emitRender()
    await waitForMicrotaskCondition(() => terminalCalls.write.mock.calls.length === 1)

    expect(frame?.style.visibility).toBe('')
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x1b[1;1R',
    })
  })

  test('discards an xterm protocol reply generated by snapshot replay', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    term.write.mockImplementationOnce((_data: string, callback?: () => void) => {
      term.emitData('\x1b[1;1R')
      if (callback) queueMicrotask(callback)
    })
    attach.resolve(attachResult('pty_session_1_aaaaaaaaa', { snapshot: '\x1b[6n', snapshotSeq: 1 }))

    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('\x1b[6n', expect.any(Function))
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('ignores stale-generation output without delaying fresh stream presentation', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()
    emitSessionOutput(session, 0, 'stale prompt')
    await Promise.resolve()

    expect(term.write).not.toHaveBeenCalled()
    expect(frame?.style.visibility).toBe('hidden')

    term.emitRender()
    await waitForMicrotaskCondition(() => frame?.style.visibility === '')

    expect(term.write).not.toHaveBeenCalled()
    emitSessionOutput(session, 1, 'current prompt')
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('current prompt', expect.any(Function))
    expect(frame?.style.visibility).toBe('')
  })

  test('cancels a fresh stream presentation that detaches before its viewport render', async () => {
    const { host, session, term, frame } = await startHiddenFreshStreamPresentation()
    expect(frame?.style.visibility).toBe('hidden')
    session.detach(host)
    await flushTerminalStart()

    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.write).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('keeps a prepared server session opening while the local xterm attach is pending', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)

    expect(session.snapshot().phase).toBe('opening')

    session.attach(host)
    await flushTerminalStart()

    expect(session.snapshot().phase).toBe('opening')
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    expect(terminalCalls.resize).not.toHaveBeenCalled()
    xtermMocks.terminals[0]!.emitData('typed-before-attach')
    await flushTerminalStart()
    expect(terminalCalls.write).not.toHaveBeenCalled()

    attach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot().phase).toBe('open')
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(notify).not.toHaveBeenCalledWith('projection-delta-revision', expect.any(Number))
  })

  test('drops xterm resize and input mutations until snapshot replay has committed', async () => {
    xtermMocks.deferWriteCallbacks(true)
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'screen' }))
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    term.resize(90, 25)
    term.emitUserData('typed-during-replay')
    await flushTerminalStart()

    expect(terminalCalls.resize).not.toHaveBeenCalled()
    expect(terminalCalls.write).not.toHaveBeenCalled()

    xtermMocks.flushDeferredWriteCallbacks()
    xtermMocks.deferWriteCallbacks(false)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')
    await flushTerminalStart()

    expect(terminalCalls.resize).not.toHaveBeenCalled()
  })

  test('does not treat an existing error snapshot attach as an operation-owned delta', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        phase: 'error',
        message: 'process unavailable',
        canonicalSize: { cols: 80, rows: 24 },
      }),
    )
    const host = createTerminalHost()
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)

    session.attach(host)
    await flushUntil(() => session.snapshot().phase === 'error')
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(terminalCalls.attach).toHaveBeenCalledOnce()
    expect(notify).not.toHaveBeenCalledWith('projection-delta-revision', expect.any(Number))
  })

  test('does not attach or reveal when the host becomes unmeasurable before fit', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect)
      .mockReturnValueOnce(terminalRect(800, 400))
      .mockReturnValue(terminalRect(0, 0))
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-frame .xterm')).toBeNull()
  })

  test('fences resize and restart requests to the retiring generation', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    terminalCalls.resize.mockClear()

    xtermMocks.terminals[0]!.resize(90, 25)
    await Promise.resolve()
    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.resize).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 90,
      rows: 25,
    })
  })

  test('does not close the server session when deselected while attach is in flight', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    session.detach(host)
    attach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(terminalCalls.close).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalledWith('projection-delta-revision', expect.any(Number))
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('disposes the observer and aborts xterm creation during font preload', async () => {
    const preload = Promise.withResolvers<void>()
    geometryMocks.preloadTerminalFont.mockReturnValueOnce(preload.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    const observer = MockResizeObserver.instances[0]
    if (!observer) throw new Error('expected resize observer')

    session.dispose()
    preload.resolve()
    await flushTerminalStart()

    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals).toHaveLength(0)
  })

  test('does not dispatch attach after the view detaches during font preload', async () => {
    const preload = Promise.withResolvers<void>()
    geometryMocks.preloadTerminalFont.mockReturnValueOnce(preload.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => geometryMocks.preloadTerminalFont.mock.calls.length === 1)
    session.detach(host)
    preload.resolve()
    await flushTerminalStart()

    expect(terminalCalls.attach).not.toHaveBeenCalled()
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(0)
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('remeasures without refreshing or scrolling after fonts finish loading', async () => {
    const { term } = await startOpenControllerSession()
    const fitAddon = xtermMocks.fitAddons[0]!
    term.refresh.mockClear()
    term.scrollToBottom.mockClear()
    fitAddon.proposeDimensions.mockClear()

    mockFonts.resolveReady()
    await flushFontRefit()

    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(term.refresh).not.toHaveBeenCalled()
    expect(term.scrollToBottom).not.toHaveBeenCalled()

    fitAddon.proposeDimensions.mockClear()

    mockFonts.emitLoadingDone()
    await flushFontRefit()

    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(term.refresh).not.toHaveBeenCalled()
    expect(term.scrollToBottom).not.toHaveBeenCalled()
  })

  test('does not resize or scroll the discarded xterm when attach resolves as viewer', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.scrollToBottom).not.toHaveBeenCalled()
  })

  test('activates Unicode 11 and exposes terminal search', async () => {
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    const { term } = await startOpenControllerSession(session)
    notify.mockClear()

    expect(term.unicode.activeVersion).toBe('11')
    expect(session.findNext('needle', true)).toEqual({ resultIndex: 0, resultCount: 2, found: true })
    expect(xtermMocks.searchAddons[0]!.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ incremental: true, caseSensitive: false }),
    )
    expect(session.findPrevious('needle')).toEqual({ resultIndex: 0, resultCount: 2, found: true })
    expect(session.findNext('missing')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
    session.clearSearch()
    expect(xtermMocks.searchAddons[0]!.clearDecorations).toHaveBeenCalled()
    expect(session.snapshot().search).toBeUndefined()
    expect(notify.mock.calls.every(([reason]) => reason === 'snapshot')).toBe(true)
    expect(notify).toHaveBeenCalled()
  })

  test('handles mac option arrows with VS Code-like terminal input', async () => {
    const savedPlatform = navigator.platform
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' })
    try {
      const { term } = await startOpenControllerSession()
      expect(term.options.macOptionIsMeta).toBe(true)
      expect(term.customKeyEventHandler).toBeTypeOf('function')
      term.scrollToBottom.mockClear()

      expect(term.customKeyEventHandler?.(optionArrow('ArrowLeft'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowRight'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowUp'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowDown'))).toBe(false)
      expect(term.scrollToBottom).toHaveBeenCalledTimes(4)
      await flushTerminalStart()

      // Rapid option-arrow keys are batched into a single write via queueMicrotask.
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(terminalCalls.write).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        data: '\x1bb\x1bf\x1b[A\x1b[B',
      })

      term.modes.applicationCursorKeysMode = true
      term.scrollToBottom.mockClear()
      expect(term.customKeyEventHandler?.(optionArrow('ArrowLeft'))).toBe(true)
      expect(term.scrollToBottom).not.toHaveBeenCalled()
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value: savedPlatform })
    }
  })

  test('works around Safari Shift+symbol key bug by sending correct char directly', async () => {
    const savedUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    })
    try {
      const { term } = await startOpenControllerSession()
      expect(term.customKeyEventHandler).toBeTypeOf('function')
      term.scrollToBottom.mockClear()

      // Safari reports unshifted '/' for Shift+Slash — workaround should send '?'.
      const slashEvent = keyboardEventForTest('keydown', {
        key: '/',
        code: 'Slash',
        shiftKey: true,
        cancelable: true,
      })
      expect(term.customKeyEventHandler?.(slashEvent)).toBe(false)

      // Safari reports empty key for Shift+Digit1 — workaround should send '!'.
      const digit1Event = keyboardEventForTest('keydown', {
        key: '',
        code: 'Digit1',
        shiftKey: true,
        cancelable: true,
      })
      expect(term.customKeyEventHandler?.(digit1Event)).toBe(false)
      expect(term.scrollToBottom).toHaveBeenCalledTimes(2)

      await flushTerminalStart()

      // Rapid Safari shift keys are batched into a single write via queueMicrotask.
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(terminalCalls.write).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        data: '?!',
      })
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: savedUserAgent })
    }
  })

  test('routes WebLinks and OSC 8 hyperlinks through the safe shell bridge', async () => {
    const { term } = await startOpenControllerSession()
    xtermMocks.webLinkAddons[0]!.open('https://example.com/path')
    const event = new MouseEvent('click', { cancelable: true })
    term.options.linkHandler!.activate(event, 'https://example.com/osc8', {
      start: { x: 1, y: 1 },
      end: { x: 10, y: 1 },
    })
    await Promise.resolve()

    expect(event.defaultPrevented).toBe(true)
    expect(term.options.linkHandler!.allowNonHttpProtocols).toBe(false)
    expect(hostOpenExternalUrl).toHaveBeenNthCalledWith(1, { url: 'https://example.com/path', allowHttp: true })
    expect(hostOpenExternalUrl).toHaveBeenNthCalledWith(2, { url: 'https://example.com/osc8', allowHttp: true })
  })

  test('does not send unsafe web links to the app ipc', async () => {
    await startOpenControllerSession()
    xtermMocks.webLinkAddons[0]!.open('javascript:alert(1)')
    xtermMocks.webLinkAddons[0]!.open('file:///tmp/secret')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/\u0000bad')
    await Promise.resolve()

    expect(hostOpenExternalUrl).not.toHaveBeenCalled()
  })

  test('keeps the terminal usable when every optional addon fails', async () => {
    Object.assign(xtermMocks.addonFailures, {
      search: true,
      unicode: true,
      webLinks: true,
      image: true,
      progress: true,
    })
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const { session } = await startOpenControllerSession()

    expect(session.snapshot().phase).toBe('open')
    expect(session.findNext('needle')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
    expect(warnSpy).toHaveBeenCalledWith('failed to load unicode11 addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load web links addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load search addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load image addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load progress addon', { err: expect.any(Error) })
    warnSpy.mockRestore()
  })
})
