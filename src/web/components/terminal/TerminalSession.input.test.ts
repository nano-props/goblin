// @vitest-environment jsdom

import {
  attachResult,
  createTerminalHost,
  descriptor,
  emitSessionOutput,
  flushTerminalStart,
  flushUntil,
  hydrateManagedSession,
  resetTerminalSessionHarness,
  setNextTerminalIdentityRevision,
  startOpenControllerSession,
  startPresentedControllerGeneration,
  terminalCalls,
  terminalGeometryMocks,
  terminalXtermMocks,
} from '#/web/test-utils/terminal-session.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalResizeResult, TerminalWriteResult } from '#/shared/terminal-types.ts'
import { flushMicrotasks, waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'

const xtermMocks = terminalXtermMocks()
const geometryMocks = terminalGeometryMocks()

beforeEach(resetTerminalSessionHarness)

describe('TerminalSession input, resize, and controller authority', () => {
  test('publishes changed Composer session state without notifying for accepted no-ops', () => {
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)

    expect(session.setComposerExpanded(false)).toBe(true)
    expect(session.setComposerMode('keys')).toBe(true)
    expect(notify).not.toHaveBeenCalled()

    expect(session.setComposerExpanded(true)).toBe(true)
    expect(session.setComposerMode('input')).toBe(true)
    expect(notify.mock.calls).toEqual([['snapshot'], ['snapshot']])

    session.dispose()
    expect(session.setComposerExpanded(false)).toBe(false)
    expect(session.setComposerMode('keys')).toBe(false)
    expect(notify.mock.calls).toEqual([['snapshot'], ['snapshot']])
  })

  test('retains Composer session facts through presentation detach and runtime restart', async () => {
    const session = new TerminalSession(descriptor, vi.fn())
    const { host } = await startOpenControllerSession(session)
    session.setComposerExpanded(true)
    session.setComposerMode('input')
    await expect(session.submitText('retained command')).resolves.toBe(true)

    session.detach(host)
    expect(session.snapshot().composer).toEqual({
      expanded: true,
      mode: 'input',
      historyEntries: ['retained command'],
    })

    session.attach(host)
    await flushTerminalStart()
    session.restart()
    expect(session.snapshot().composer).toEqual({
      expanded: true,
      mode: 'input',
      historyEntries: ['retained command'],
    })
  })

  test('batches rapid user input into a single ordered write', async () => {
    const { term } = await startOpenControllerSession()
    term.emitData('c')
    term.emitData('l')
    term.emitData('e')
    term.emitData('a')
    term.emitData('r')
    await flushTerminalStart()

    expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'clear',
    })
  })

  test('drops buffered input after dispose', async () => {
    const { session, term } = await startOpenControllerSession()

    term.emitData('x')
    session.dispose()

    await flushTerminalStart()

    // The pending write buffer is cleared on dispose; nothing is sent.
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test.each([
    'server rejection',
    'transport failure',
    'session mismatch',
    'generation mismatch',
    'canonical size mismatch',
  ] as const)('rebuilds the view from an authoritative snapshot after a resize %s', async (failure) => {
    if (failure === 'server rejection') {
      terminalCalls.resize.mockResolvedValueOnce({ ok: false, message: 'error.unavailable' })
    } else if (failure === 'transport failure') {
      terminalCalls.resize.mockRejectedValueOnce(new Error('resize failed'))
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

  test('does not send resize or input while attached as a mirror page before explicit takeover', async () => {
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

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushMicrotasks(2)
    expect(terminalCalls.resize).not.toHaveBeenCalled()

    xtermMocks.terminals[0]!.emitData('input')
    await flushTerminalStart()

    expect(terminalCalls.write).not.toHaveBeenCalled()
    expect(terminalCalls.resize).not.toHaveBeenCalled()
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
  })

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

  test('does not notify on ordinary input while already attached', async () => {
    const host = createTerminalHost()
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    xtermMocks.terminals[0]!.emitData('hello')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'hello',
    })
    expect(notify).not.toHaveBeenCalled()
  })

  test('uses a captured input writer for the active presented generation', async () => {
    const { session } = await startPresentedControllerGeneration()

    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')
    expect(inputWriter("bat '/worktree/file.ts'\r")).toBe(true)
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: "bat '/worktree/file.ts'\r",
    })
  })

  test('encodes virtual keys at the current xterm input boundary', async () => {
    const { session, term } = await startPresentedControllerGeneration()

    for (const [key, data] of [
      ['enter', '\r'],
      ['backspace', '\x7f'],
      ['eof', '\x04'],
    ] as const) {
      terminalCalls.write.mockClear()
      session.sendVirtualKey(key)
      await flushUntil(() => terminalCalls.write.mock.calls.length > 0)
      expect(term.input).toHaveBeenLastCalledWith(data, true)
      expect(terminalCalls.write).toHaveBeenLastCalledWith({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        data,
      })
    }

    term.scrollToBottom.mockClear()
    session.sendVirtualKey('arrow-up')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)
    expect(term.input).toHaveBeenLastCalledWith('\x1b[A', true)
    expect(term.scrollToBottom).toHaveBeenCalledOnce()
    expect(terminalCalls.write).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x1b[A',
    })

    terminalCalls.write.mockClear()
    term.modes.applicationCursorKeysMode = true
    term.options.scrollOnUserInput = false
    term.scrollToBottom.mockClear()
    session.sendVirtualKey('arrow-right')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)
    expect(term.input).toHaveBeenLastCalledWith('\x1bOC', true)
    expect(term.scrollToBottom).not.toHaveBeenCalled()
    expect(terminalCalls.write).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x1bOC',
    })

    terminalCalls.write.mockClear()
    term.options.scrollOnUserInput = true
    session.sendVirtualKey('interrupt')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)
    expect(terminalCalls.write).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x03',
    })
  })

  test('submits composed text through xterm paste semantics followed by Enter', async () => {
    const { session, term } = await startPresentedControllerGeneration()
    term.modes.bracketedPasteMode = true
    const pasteWrite = Promise.withResolvers<TerminalWriteResult>()
    terminalCalls.write.mockImplementationOnce(() => pasteWrite.promise)

    const submission = session.submitText('first line\nsecond line')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)

    expect(term.paste).toHaveBeenCalledWith('first line\nsecond line')
    expect(term.input).not.toHaveBeenCalled()
    expect(terminalCalls.write).toHaveBeenNthCalledWith(1, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x1b[200~first line\rsecond line\x1b[201~',
    })

    pasteWrite.resolve({ status: 'accepted' })
    await expect(submission).resolves.toBe(true)

    expect(term.input).toHaveBeenCalledWith('\r', true)
    expect(terminalCalls.write).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\r',
    })
  })

  test('fast-fails a concurrent composed submission and records only accepted text in session history', async () => {
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    const { term } = await startOpenControllerSession(session)
    const pasteWrite = Promise.withResolvers<TerminalWriteResult>()
    terminalCalls.write.mockReturnValueOnce(pasteWrite.promise)
    notify.mockClear()

    const firstSubmission = session.submitText('first command')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)

    await expect(session.submitText('second command')).resolves.toBe(false)
    expect(term.paste).toHaveBeenCalledTimes(1)
    expect(session.snapshot().composer.historyEntries).toEqual([])

    pasteWrite.resolve({ status: 'accepted' })
    await expect(firstSubmission).resolves.toBe(true)

    expect(session.snapshot().composer.historyEntries).toEqual(['first command'])
    expect(notify).toHaveBeenCalledWith('snapshot')
  })

  test.each(['rejected', 'indeterminate'] as const)(
    'does not retry or send Enter when the composed text write is %s',
    async (status) => {
      const { session, term } = await startPresentedControllerGeneration()
      terminalCalls.write.mockResolvedValueOnce({ status })

      await expect(session.submitText('keep this text')).resolves.toBe(false)

      expect(term.paste).toHaveBeenCalledWith('keep this text')
      expect(term.input).not.toHaveBeenCalled()
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(session.snapshot().composer.historyEntries).toEqual([])
    },
  )

  test('releases the submission guard after a failed settlement so the user can retry', async () => {
    const { session } = await startPresentedControllerGeneration()
    terminalCalls.write.mockResolvedValueOnce({ status: 'rejected' })

    await expect(session.submitText('retry this command')).resolves.toBe(false)
    terminalCalls.write.mockResolvedValueOnce({ status: 'accepted' })

    await expect(session.submitText('retry this command')).resolves.toBe(true)
    expect(session.snapshot().composer.historyEntries).toEqual(['retry this command'])
  })

  test('preserves an accepted result but skips history when the session is disposed before settlement', async () => {
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    const { term } = await startOpenControllerSession(session)
    const pasteWrite = Promise.withResolvers<TerminalWriteResult>()
    terminalCalls.write.mockReturnValueOnce(pasteWrite.promise)
    notify.mockClear()

    const submission = session.submitText('accepted after close')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)
    session.dispose()
    pasteWrite.resolve({ status: 'accepted' })

    await expect(submission).resolves.toBe(true)
    expect(session.snapshot().composer.historyEntries).toEqual([])
    expect(notify).not.toHaveBeenCalled()
    expect(term.input).not.toHaveBeenCalled()
  })

  test('honors an accepted composed text write after its presentation binding becomes stale', async () => {
    const { session, term } = await startPresentedControllerGeneration()
    const pasteWrite = Promise.withResolvers<TerminalWriteResult>()
    terminalCalls.write.mockReturnValueOnce(pasteWrite.promise)

    const submission = session.submitText('accepted before takeover')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    pasteWrite.resolve({ status: 'accepted' })

    await expect(submission).resolves.toBe(true)
    expect(term.input).not.toHaveBeenCalled()
    expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    expect(session.snapshot().composer.historyEntries).toEqual(['accepted before takeover'])
  })

  test('does not send the following Enter to a replacement generation after old text is accepted', async () => {
    const { session } = await startPresentedControllerGeneration()
    const pasteWrite = Promise.withResolvers<TerminalWriteResult>()
    terminalCalls.write.mockReturnValueOnce(pasteWrite.promise)

    const submission = session.submitText('accepted by the old generation')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 2,
        identityRevision: 3,
      }),
    )
    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
      identityRevision: 2,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushTerminalStart()
    const replacementTerm = xtermMocks.terminals.at(-1)!

    pasteWrite.resolve({ status: 'accepted' })

    await expect(submission).resolves.toBe(true)
    expect(replacementTerm.input).not.toHaveBeenCalled()
    expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    expect(session.snapshot().composer.historyEntries).toEqual(['accepted by the old generation'])
  })

  test('settles an accepted submission without waiting for the following Enter acknowledgement', async () => {
    const { session, term } = await startPresentedControllerGeneration()
    const enterWrite = Promise.withResolvers<TerminalWriteResult>()
    terminalCalls.write.mockResolvedValueOnce({ status: 'accepted' }).mockReturnValueOnce(enterWrite.promise)

    const submission = session.submitText('deliver without waiting')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 2)

    await expect(submission).resolves.toBe(true)
    expect(session.snapshot().composer.historyEntries).toEqual(['deliver without waiting'])
    expect(term.input).toHaveBeenCalledWith('\r', true)
    expect(terminalCalls.write).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\r',
    })

    enterWrite.resolve({ status: 'accepted' })
    await flushTerminalStart()
  })

  test('treats accepted composed text as delivered when the following Enter is rejected', async () => {
    const { session, term } = await startPresentedControllerGeneration()
    terminalCalls.write.mockResolvedValueOnce({ status: 'accepted' }).mockResolvedValueOnce({ status: 'rejected' })

    await expect(session.submitText('delivered once')).resolves.toBe(true)

    expect(term.paste).toHaveBeenCalledWith('delivered once')
    expect(term.input).toHaveBeenCalledWith('\r', true)
    expect(terminalCalls.write).toHaveBeenCalledTimes(2)
    expect(session.snapshot().composer.historyEntries).toEqual(['delivered once'])
  })

  test('commits asynchronous input only to the generation captured by its writer', async () => {
    const { session } = await startPresentedControllerGeneration()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.restart()

    expect(inputWriter("'/tmp/from-old-generation'")).toBe(false)
    await flushTerminalStart()
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('rejects a captured input writer after controller authority is lost', async () => {
    const { session } = await startPresentedControllerGeneration()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    expect(inputWriter("'/tmp/after-takeover'")).toBe(false)
    await Promise.resolve()
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('keeps a captured input writer bound to the same runtime generation across presentation rebuilds', async () => {
    const { host, session } = await startPresentedControllerGeneration()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.detach(host)
    session.attach(host)
    await flushTerminalStart()
    expect(inputWriter("'/tmp/from-old-presentation'")).toBe(true)
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: "'/tmp/from-old-presentation'",
    })
  })
})
