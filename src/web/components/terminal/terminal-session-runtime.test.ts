import { describe, expect, test } from 'vitest'
import { TerminalSessionRuntime } from '#/web/components/terminal/terminal-session-runtime.ts'

function applyAttachResult(
  runtime: TerminalSessionRuntime,
  result: Parameters<TerminalSessionRuntime['commitAttachResult']>[1],
  fallbackSize: Parameters<TerminalSessionRuntime['commitAttachResult']>[2],
): boolean {
  const attempt = runtime.currentAttemptToken() ?? runtime.startAttaching().attempt
  const committed = runtime.commitAttachResult(attempt, result, fallbackSize)
  if (!committed.accepted) throw new Error('test attach result was not accepted')
  return committed.changed
}

describe('TerminalSessionRuntime', () => {
  test('tracks restart flow and replacing session ids', () => {
    const runtime = new TerminalSessionRuntime()

    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        frame: 'snapshot',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
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

    expect(runtime.currentTerminalRuntimeSessionId()).toBe('pty_session_1_aaaaaaaaa')
    expect(runtime.snapshot().attachment).toMatchObject({ active: true, canTakeover: false })

    runtime.prepareRestart()

    expect(runtime.currentTerminalRuntimeSessionId()).toBeNull()
    expect(runtime.phase()).toBe('restarting')
    expect(runtime.snapshot().attachment).toBeUndefined()
    expect(runtime.consumeRestartFlag()).toBe(true)
    expect(runtime.takePendingRestartTerminalRuntimeSessionIdForClose()).toBe('pty_session_1_aaaaaaaaa')
  })

  test('routes output, identity, replay, and takeover through runtime state', () => {
    const runtime = new TerminalSessionRuntime()
    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        frame: 'snapshot',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
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

    expect(runtime.snapshot().attachment).toMatchObject({ active: false, canTakeover: true })

    runtime.beginReplay({ outputEra: 0, seq: 2 })
    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'old',
        seq: 1,
        outputEra: 0,
        processName: 'zsh',
      }),
    ).toEqual({
      changed: false,
      output: null,
    })
    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'new',
        seq: 3,
        outputEra: 0,
        processName: 'bash',
      }),
    ).toEqual({
      changed: true,
      output: null,
    })
    expect(runtime.processName()).toBe('bash')
    expect(runtime.finishReplay()).toEqual([
      {
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'new',
        seq: 3,
        outputEra: 0,
        processName: 'bash',
      },
    ])
  })

  test('does not own rendered-output dedupe outside replay', () => {
    const runtime = new TerminalSessionRuntime()
    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        frame: 'snapshot',
        snapshot: 'prompt',
        snapshotSeq: 1,
        outputEra: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_local', status: 'connected' },
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      },
      { cols: 100, rows: 30 },
    )

    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'prompt',
        seq: 1,
        outputEra: 0,
        processName: 'zsh',
      }),
    ).toEqual({ changed: false, output: 'prompt' })
    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'next',
        seq: 2,
        outputEra: 0,
        processName: 'zsh',
      }),
    ).toEqual({ changed: false, output: 'next' })
  })

  test('keeps metadata hydration independent from rendered-output checkpoints', () => {
    const runtime = new TerminalSessionRuntime()
    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        frame: 'snapshot',
        snapshot: 'prompt',
        snapshotSeq: 1,
        outputEra: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_local', status: 'connected' },
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      },
      { cols: 100, rows: 30 },
    )

    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'next',
        seq: 2,
        outputEra: 0,
        processName: 'zsh',
      }),
    ).toEqual({ changed: false, output: 'next' })
    runtime.hydrateRepoSession({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'zsh',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'next-again',
        seq: 2,
        outputEra: 0,
        processName: 'zsh',
      }),
    ).toEqual({ changed: false, output: 'next-again' })

    runtime.hydrateRepoSession({
      terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'zsh',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'new-session-output',
        seq: 1,
        outputEra: 0,
        processName: 'zsh',
      }),
    ).toEqual({ changed: false, output: 'new-session-output' })
  })

  test('drainReplay discards the replay buffer without surfacing captured events', () => {
    // The error / cancellation path in `TerminalSession` calls
    // `drainReplay` to clear the preload's replay window when the
    // attach fails partway through. drainReplay must not surface
    // captured events to the term.
    const runtime = new TerminalSessionRuntime()
    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        frame: 'snapshot',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
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

    runtime.beginReplay({ outputEra: 0, seq: 2 })
    runtime.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'new',
      seq: 3,
      outputEra: 0,
      processName: 'bash',
    })
    runtime.drainReplay()
    // Subsequent finishReplay returns nothing — the buffer was cleared.
    expect(runtime.finishReplay()).toEqual([])
  })

  test('a preload window followed by a post-attach window keeps events newer than the new snapshot seq', () => {
    // This is the contract that `TerminalSession.preloadHydratedSnapshot`
    // and `replayActiveView` rely on: the preload's beginReplay starts
    // a window that the post-attach's beginReplay extends with a
    // higher boundary, and the post-attach's finishReplay returns
    // events captured during *both* writes — filtered by the new
    // boundary. Events older than the new snapshot are dropped (they
    // are in the new snapshot), events newer than the new snapshot
    // are kept (they are live output since the snapshot).
    const runtime = new TerminalSessionRuntime()
    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        frame: 'snapshot',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
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

    // Preload window: events arrive during the server-snapshot write.
    // The boundary is the server snapshot's seq.
    runtime.beginReplay({ outputEra: 0, seq: 2 })
    runtime.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'preload-old',
      seq: 3,
      outputEra: 0,
      processName: 'bash',
    })
    runtime.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'preload-new',
      seq: 6,
      outputEra: 0,
      processName: 'bash',
    })

    // Post-attach window: the new snapshot is at seq=5. Update the
    // boundary; the buffer is preserved across the call.
    runtime.beginReplay({ outputEra: 0, seq: 5 })
    runtime.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'post-attach',
      seq: 7,
      outputEra: 0,
      processName: 'bash',
    })

    const events = runtime.finishReplay()
    // preload-old (seq 3) is older than the new snapshot (seq=5) → dropped
    // preload-new (seq 6) is newer than the new snapshot → kept
    // post-attach (seq 7) is newer than the new snapshot → kept
    expect(events.map((e) => e.data)).toEqual(['preload-new', 'post-attach'])
  })

  test('preserves server-provided title when attaching an existing session', () => {
    const runtime = new TerminalSessionRuntime()

    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        frame: 'snapshot',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
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

    expect(runtime.snapshot()).toMatchObject({
      phase: 'open',
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
  })

  test('hydrates externally created sessions into open mirror state', () => {
    const runtime = new TerminalSessionRuntime()

    expect(
      runtime.hydrateRepoSession({
        terminalRuntimeSessionId: 'term-remoteremoteremote001',
        terminalRuntimeGeneration: 1,
        phase: 'open',
        message: null,
        processName: 'node',
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 132,
        canonicalRows: 43,
      }),
    ).toEqual({ disposition: 'applied', changed: true })

    expect(runtime.currentTerminalRuntimeSessionId()).toBe('term-remoteremoteremote001')
    expect(runtime.phase()).toBe('open')
    expect(runtime.snapshot().attachment).toMatchObject({
      role: 'viewer',
      controllerStatus: 'connected',
      active: false,
      canTakeover: true,
      canonicalCols: 132,
      canonicalRows: 43,
    })
    expect(
      runtime.handleOutput({
        terminalRuntimeSessionId: 'term-remoteremoteremote001',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-remoteremoteremote001',
        data: 'tick',
        seq: 1,
        outputEra: 0,
        processName: 'node',
      }),
    ).toEqual({
      changed: false,
      output: 'tick',
    })
  })

  test('resetTransientState clears transient terminal state without dropping runtime metadata', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
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

describe('TerminalSessionRuntime runtime binding generations', () => {
  test('keeps the retiring binding addressable and rejects its delayed exit during restart', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession({
      terminalRuntimeSessionId: 'pty_runtime_generation_test',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 80,
      canonicalRows: 24,
    })

    runtime.prepareRestart()

    expect(runtime.currentRuntimeBinding()).toBeNull()
    expect(runtime.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_runtime_generation_test',
      terminalRuntimeGeneration: 1,
    })
    expect(
      runtime.classifyRuntimeBinding({
        terminalRuntimeSessionId: 'pty_runtime_generation_test',
        terminalRuntimeGeneration: 1,
      }),
    ).toBe('retiring')
    expect(
      runtime.handleExit({
        terminalRuntimeSessionId: 'pty_runtime_generation_test',
        terminalRuntimeGeneration: 1,
      }),
    ).toBe(false)
  })
})

describe('TerminalSessionRuntime restart generation activation', () => {
  test('activates the replacement after ignoring the retiring generation exit', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession({
      terminalRuntimeSessionId: 'pty_restart_activation_test',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 80,
      canonicalRows: 24,
    })
    runtime.prepareRestart()
    expect(
      runtime.handleExit({
        terminalRuntimeSessionId: 'pty_restart_activation_test',
        terminalRuntimeGeneration: 1,
      }),
    ).toBe(false)

    applyAttachResult(
      runtime,
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_restart_activation_test',
        terminalRuntimeGeneration: 2,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        frame: 'snapshot',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
        role: 'controller',
        controllerStatus: 'connected',
      },
      { cols: 100, rows: 30 },
    )

    expect(runtime.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_restart_activation_test',
      terminalRuntimeGeneration: 2,
    })
    expect(runtime.terminalRuntimeSessionIdsForClose()).toEqual(['pty_restart_activation_test'])
  })
})

describe('TerminalSessionRuntime exact start attempts', () => {
  const attachResult = (
    terminalRuntimeGeneration: number,
  ): Parameters<TerminalSessionRuntime['commitAttachResult']>[1] => ({
    ok: true,
    terminalRuntimeSessionId: 'pty_exact_attempt_aaaa',
    terminalRuntimeGeneration,
    frame: 'snapshot',
    snapshot: '',
    snapshotSeq: 0,
    outputEra: 0,
    phase: 'open',
    message: null,
    processName: 'zsh',
    canonicalTitle: null,
    canonicalCols: 80,
    canonicalRows: 24,
    role: 'controller',
    controllerStatus: 'connected',
    controller: { clientId: 'client-exact-attempt', status: 'connected' },
  })

  test('ignores attempt A late success and failure after restart attempt B begins', () => {
    const runtime = new TerminalSessionRuntime()
    applyAttachResult(runtime, attachResult(1), { cols: 80, rows: 24 })
    const attemptA = runtime.prepareRestart().attempt
    const attemptB = runtime.prepareRestart().attempt

    expect(runtime.commitAttachResult(attemptA, attachResult(2), { cols: 80, rows: 24 })).toEqual({
      accepted: false,
      changed: false,
      resolution: 'superseded',
    })
    expect(runtime.failStartAttempt(attemptA, 'late failure')).toEqual({
      accepted: false,
      changed: false,
      resolution: 'superseded',
    })
    expect(runtime.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_exact_attempt_aaaa',
      terminalRuntimeGeneration: 1,
    })

    expect(runtime.commitAttachResult(attemptB, attachResult(2), { cols: 80, rows: 24 }).accepted).toBe(true)
    expect(runtime.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_exact_attempt_aaaa',
      terminalRuntimeGeneration: 2,
    })
  })

  test('accepts failure only for the current restart attempt', () => {
    const runtime = new TerminalSessionRuntime()
    applyAttachResult(runtime, attachResult(1), { cols: 80, rows: 24 })
    const attemptA = runtime.prepareRestart().attempt
    const attemptB = runtime.prepareRestart().attempt

    expect(runtime.failStartAttempt(attemptA, 'late failure').accepted).toBe(false)
    expect(runtime.failStartAttempt(attemptB, 'current failure').accepted).toBe(true)
    expect(runtime.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_exact_attempt_aaaa',
      terminalRuntimeGeneration: 1,
    })
  })
})

describe('TerminalSessionRuntime authoritative hydration during attempts', () => {
  const hydration = (terminalRuntimeGeneration: number, phase: 'open' | 'error' = 'open') => ({
    terminalRuntimeSessionId: 'pty_authoritative_hydration',
    terminalRuntimeGeneration,
    phase,
    message: phase === 'error' ? 'server error' : null,
    processName: `shell-${terminalRuntimeGeneration}`,
    canonicalTitle: null,
    role: 'controller' as const,
    controllerStatus: 'connected' as const,
    canonicalCols: 80,
    canonicalRows: 24,
  })
  const attachResult = (terminalRuntimeGeneration: number) => ({
    ok: true as const,
    ...hydration(terminalRuntimeGeneration),
    frame: 'snapshot' as const,
    snapshot: '',
    snapshotSeq: 0,
    outputEra: terminalRuntimeGeneration,
    controller: { clientId: 'client-authoritative', status: 'connected' as const },
  })

  test('stages concurrent reconciliation without erasing the current restart attempt', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession(hydration(1))
    const attempt = runtime.prepareRestart().attempt

    expect(runtime.hydrateRepoSession(hydration(1))).toEqual({
      disposition: 'staged',
      changed: false,
      candidateAccepted: false,
      activationPending: false,
    })
    expect(runtime.currentAttemptToken()).toEqual(attempt)
    expect(runtime.commitAttachResult(attempt, attachResult(2), { cols: 80, rows: 24 })).toMatchObject({
      accepted: true,
      resolution: 'response',
    })
    expect(runtime.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_authoritative_hydration',
      terminalRuntimeGeneration: 2,
    })
  })

  test('falls back to the latest authoritative snapshot when the restart attempt fails', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession(hydration(1))
    const attempt = runtime.prepareRestart().attempt
    runtime.hydrateRepoSession(hydration(2, 'error'))

    expect(runtime.failStartAttempt(attempt, 'request failed')).toMatchObject({
      accepted: true,
      resolution: 'staged',
    })
    expect(runtime.currentRuntimeBinding()).toBeNull()
    const pending = runtime.pendingAuthoritativeRuntimeBinding()
    expect(pending).toEqual({
      terminalRuntimeSessionId: 'pty_authoritative_hydration',
      terminalRuntimeGeneration: 2,
    })
    expect(runtime.commitPendingAuthoritativeHydration(pending!)).toMatchObject({ accepted: true })
    expect(runtime.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_authoritative_hydration',
      terminalRuntimeGeneration: 2,
    })
    expect(runtime.phase()).toBe('error')
  })

  test('lets a future authoritative generation supersede an older attach response', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession(hydration(1))
    const attempt = runtime.prepareRestart().attempt
    runtime.hydrateRepoSession(hydration(3))

    expect(runtime.commitAttachResult(attempt, attachResult(2), { cols: 80, rows: 24 })).toMatchObject({
      accepted: true,
      resolution: 'staged',
    })
    expect(runtime.currentRuntimeBinding()).toBeNull()
    const pending = runtime.pendingAuthoritativeRuntimeBinding()
    expect(pending).toEqual({
      terminalRuntimeSessionId: 'pty_authoritative_hydration',
      terminalRuntimeGeneration: 3,
    })
    expect(runtime.commitPendingAuthoritativeHydration(pending!)).toMatchObject({ accepted: true })
    expect(runtime.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_authoritative_hydration',
      terminalRuntimeGeneration: 3,
    })
    expect(runtime.processName()).toBe('shell-3')
  })

  test('does not let a partial effect regress or replace an active binding', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession(hydration(2))

    expect(runtime.hydrateRepoSession(hydration(1), 'partial-effect')).toEqual({
      disposition: 'ignored',
      changed: false,
    })
    expect(
      runtime.hydrateRepoSession(
        { ...hydration(1), terminalRuntimeSessionId: 'pty_old_lineage_aaaaaaaa' },
        'partial-effect',
      ),
    ).toEqual({ disposition: 'ignored', changed: false })
    expect(runtime.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_authoritative_hydration',
      terminalRuntimeGeneration: 2,
    })
  })

  test('does not use a retiring snapshot as restart failure fallback', () => {
    const runtime = new TerminalSessionRuntime()
    runtime.hydrateRepoSession(hydration(1))
    const attempt = runtime.prepareRestart().attempt

    expect(runtime.hydrateRepoSession(hydration(1))).toMatchObject({
      disposition: 'staged',
      candidateAccepted: false,
    })
    expect(
      runtime.handleExit({
        terminalRuntimeSessionId: 'pty_authoritative_hydration',
        terminalRuntimeGeneration: 1,
      }),
    ).toBe(false)
    expect(runtime.failStartAttempt(attempt, 'restart failed')).toMatchObject({
      accepted: true,
      resolution: 'error',
    })
    expect(runtime.currentRuntimeBinding()).toBeNull()
    expect(runtime.phase()).toBe('error')
  })
})
