import { describe, expect, test } from 'vitest'
import { TerminalSessionRuntime } from '#/web/components/terminal/terminal-session-runtime.ts'

describe('TerminalSessionRuntime', () => {
  test('tracks restart flow and replacing session ids', () => {
    const runtime = new TerminalSessionRuntime()

    runtime.applyAttachResult(
      {
        ok: true,
        sessionId: 'session-1',
        replay: '',
        replaySeq: 0,
        replayTruncated: false,
        processName: 'zsh',
        canonicalTitle: null,
        controller: { attachmentId: 'attachment_local', status: 'connected' },
        role: 'controller',
        controllerStatus: 'connected',
      },
      { cols: 100, rows: 30 },
    )
    runtime.markAttached()

    expect(runtime.currentSessionId()).toBe('session-1')
    expect(runtime.snapshot().attachment).toMatchObject({ active: true, canTakeover: false })

    runtime.prepareRestart()

    expect(runtime.currentSessionId()).toBeNull()
    expect(runtime.consumeRestartFlag()).toBe(true)
    expect(runtime.closeReplacingSessionId()).toBe('session-1')
  })

  test('routes output, ownership, replay, and takeover through runtime state', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.applyAttachResult(
      {
        ok: true,
        sessionId: 'session-1',
        replay: '',
        replaySeq: 0,
        replayTruncated: false,
        processName: 'zsh',
        canonicalTitle: null,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      },
      { cols: 100, rows: 30 },
    )
    runtime.markAttached()

    expect(runtime.snapshot().attachment).toMatchObject({ active: false, canTakeover: true })

    runtime.beginReplay(2)
    expect(runtime.handleOutput({ sessionId: 'session-1', data: 'old', seq: 1, processName: 'zsh' })).toEqual({
      changed: false,
      output: null,
    })
    expect(runtime.handleOutput({ sessionId: 'session-1', data: 'new', seq: 3, processName: 'bash' })).toEqual({
      changed: true,
      output: null,
    })
    expect(runtime.processName()).toBe('bash')
    expect(runtime.finishReplay()).toEqual([{ sessionId: 'session-1', data: 'new', seq: 3, processName: 'bash' }])

    expect(
      runtime.handleOwnership({
        sessionId: 'session-1',
        role: 'unowned',
        controllerStatus: 'none',
        canonicalCols: 90,
        canonicalRows: 20,
      }),
    ).toBe(true)
    expect(runtime.snapshot().attachment).toMatchObject({
      role: 'unowned',
      controllerStatus: 'none',
      active: false,
      canTakeover: true,
      canonicalCols: 90,
      canonicalRows: 20,
    })

    expect(
      runtime.handleOwnership({
        sessionId: 'session-1',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 101,
        canonicalRows: 31,
      }),
    ).toBe(true)
    expect(runtime.snapshot().attachment).toMatchObject({
      active: true,
      canTakeover: false,
      canonicalCols: 101,
      canonicalRows: 31,
    })
  })

  test('preserves server-provided title when attaching an existing session', () => {
    const runtime = new TerminalSessionRuntime()

    runtime.applyAttachResult(
      {
        ok: true,
        sessionId: 'session-1',
        replay: '',
        replaySeq: 0,
        replayTruncated: false,
        processName: 'zsh',
        canonicalTitle: '~/Developer/goblin — npm run dev',
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        role: 'viewer',
        controllerStatus: 'connected',
      },
      { cols: 100, rows: 30 },
    )
    runtime.markAttached()

    expect(runtime.snapshot()).toMatchObject({
      phase: 'open',
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
  })

  test('hydrates externally created sessions into open mirror state', () => {
    const runtime = new TerminalSessionRuntime()

    expect(
      runtime.hydrateSession({
        sessionId: 'session-remote',
        processName: 'node',
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 132,
        canonicalRows: 43,
      }),
    ).toBe(true)

    expect(runtime.currentSessionId()).toBe('session-remote')
    expect(runtime.phase()).toBe('open')
    expect(runtime.snapshot().attachment).toMatchObject({
      role: 'viewer',
      controllerStatus: 'connected',
      active: false,
      canTakeover: true,
      canonicalCols: 132,
      canonicalRows: 43,
    })
    expect(runtime.handleOutput({ sessionId: 'session-remote', data: 'tick', seq: 1, processName: 'node' })).toEqual({
      changed: false,
      output: 'tick',
    })
  })

  test('resetTransientState clears transient terminal state without dropping runtime metadata', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateSession({
      sessionId: 'session-1',
      processName: 'zsh',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    runtime.setSearchResult({ resultIndex: 0, resultCount: 2, found: true })
    runtime.setProgress(4, 30)

    expect(runtime.snapshot()).toMatchObject({
      phase: 'open',
      processName: 'zsh',
      attachment: {
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      },
      search: { resultIndex: 0, resultCount: 2, found: true },
      progress: { state: 4, value: 30 },
    })

    expect(runtime.resetTransientState()).toBe(true)
    expect(runtime.snapshot()).toMatchObject({
      phase: 'open',
      processName: 'zsh',
      attachment: {
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      },
    })
    expect(runtime.snapshot().search).toBeUndefined()
    expect(runtime.snapshot().progress).toBeUndefined()
  })
})
