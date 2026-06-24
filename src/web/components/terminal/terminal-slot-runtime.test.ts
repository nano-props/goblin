import { describe, expect, test } from 'vitest'
import { TerminalSlotRuntime } from '#/web/components/terminal/terminal-slot-runtime.ts'

describe('TerminalSlotRuntime', () => {
  test('tracks restart flow and replacing session ids', () => {
    const runtime = new TerminalSlotRuntime()

    runtime.applyAttachResult(
      {
        ok: true,
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
        role: 'controller',
        controllerStatus: 'connected',
      },
      { cols: 100, rows: 30 },
    )
    runtime.markAttached()

    expect(runtime.currentPtySessionId()).toBe('pty_session_1_aaaaaaaaa')
    expect(runtime.snapshot().attachment).toMatchObject({ active: true, canTakeover: false })

    runtime.prepareRestart()

    expect(runtime.currentPtySessionId()).toBeNull()
    expect(runtime.phase()).toBe('restarting')
    expect(runtime.snapshot().attachment).toBeUndefined()
    expect(runtime.consumeRestartFlag()).toBe(true)
    expect(runtime.closeReplacingPtySessionId()).toBe('pty_session_1_aaaaaaaaa')
  })

  test('routes output, ownership, replay, and takeover through runtime state', () => {
    const runtime = new TerminalSlotRuntime()
    runtime.applyAttachResult(
      {
        ok: true,
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_remote', status: 'connected' },
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
    expect(runtime.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'old', seq: 1, processName: 'zsh' })).toEqual({
      changed: false,
      output: null,
    })
    expect(runtime.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'new', seq: 3, processName: 'bash' })).toEqual({
      changed: true,
      output: null,
    })
    expect(runtime.processName()).toBe('bash')
    expect(runtime.finishReplay()).toEqual([{ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'new', seq: 3, processName: 'bash' }])
  })

  test('drainReplay discards the replay buffer without surfacing captured events', () => {
    // The error / cancellation path in `ManagedTerminalSlot` calls
    // `drainReplay` to clear the preload's replay window when the
    // attach fails partway through. drainReplay must not surface
    // captured events to the term.
    const runtime = new TerminalSlotRuntime()
    runtime.applyAttachResult(
      {
        ok: true,
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_remote', status: 'connected' },
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      },
      { cols: 100, rows: 30 },
    )
    runtime.markAttached()

    runtime.beginReplay(2)
    runtime.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'new', seq: 3, processName: 'bash' })
    runtime.drainReplay()
    // Subsequent finishReplay returns nothing — the buffer was cleared.
    expect(runtime.finishReplay()).toEqual([])
  })

  test('a preload window followed by a post-attach window keeps events newer than the new snapshot seq', () => {
    // This is the contract that `ManagedTerminalSlot.preloadHydratedSnapshot`
    // and `replayActiveView` rely on: the preload's beginReplay starts
    // a window that the post-attach's beginReplay extends with a
    // higher boundary, and the post-attach's finishReplay returns
    // events captured during *both* writes — filtered by the new
    // boundary. Events older than the new snapshot are dropped (they
    // are in the new snapshot), events newer than the new snapshot
    // are kept (they are live output since the snapshot).
    const runtime = new TerminalSlotRuntime()
    runtime.applyAttachResult(
      {
        ok: true,
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_remote', status: 'connected' },
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      },
      { cols: 100, rows: 30 },
    )
    runtime.markAttached()

    // Preload window: events arrive during the cached-snapshot write.
    // The boundary is the cached snapshot's seq.
    runtime.beginReplay(2)
    runtime.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'preload-old', seq: 3, processName: 'bash' })
    runtime.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'preload-new', seq: 6, processName: 'bash' })

    // Post-attach window: the new snapshot is at seq=5. Update the
    // boundary; the buffer is preserved across the call.
    runtime.beginReplay(5)
    runtime.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'post-attach', seq: 7, processName: 'bash' })

    const events = runtime.finishReplay()
    // preload-old (seq 3) is older than the new snapshot (seq=5) → dropped
    // preload-new (seq 6) is newer than the new snapshot → kept
    // post-attach (seq 7) is newer than the new snapshot → kept
    expect(events.map((e) => e.data)).toEqual(['preload-new', 'post-attach'])
  })

  test('preserves server-provided title when attaching an existing session', () => {
    const runtime = new TerminalSlotRuntime()

    runtime.applyAttachResult(
      {
        ok: true,
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: '~/Developer/goblin — npm run dev',
        phase: 'open',
        message: null,
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
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
    const runtime = new TerminalSlotRuntime()

    expect(
      runtime.hydrateSession({
        ptySessionId: 'session-remote',
        phase: 'open',
        message: null,
        processName: 'node',
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 132,
        canonicalRows: 43,
      }),
    ).toBe(true)

    expect(runtime.currentPtySessionId()).toBe('session-remote')
    expect(runtime.phase()).toBe('open')
    expect(runtime.snapshot().attachment).toMatchObject({
      role: 'viewer',
      controllerStatus: 'connected',
      active: false,
      canTakeover: true,
      canonicalCols: 132,
      canonicalRows: 43,
    })
    expect(runtime.handleOutput({ ptySessionId: 'session-remote', data: 'tick', seq: 1, processName: 'node' })).toEqual({
      changed: false,
      output: 'tick',
    })
  })

  test('resetTransientState clears transient terminal state without dropping runtime metadata', () => {
    const runtime = new TerminalSlotRuntime()
    runtime.hydrateSession({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'open',
      message: null,
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
