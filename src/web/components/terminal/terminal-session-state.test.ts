import { describe, expect, test } from 'vitest'
import { TerminalSessionState } from '#/web/components/terminal/terminal-session-state.ts'
import type { TerminalIdentityViewModel, TerminalLifecycleViewModel } from '#/web/components/terminal/types.ts'

const DEFAULT_COMPOSER = { expanded: false, mode: 'input' as const, draft: '', historyEntries: [] }

type IdentityAndRuntimeMetadataForTest = Parameters<TerminalSessionState['establishIdentity']>[0] &
  Parameters<TerminalSessionState['applyRuntimeMetadata']>[0]

function applyIdentityAndRuntimeMetadataForTest(
  state: TerminalSessionState,
  input: IdentityAndRuntimeMetadataForTest,
): boolean {
  const identityChanged = state.establishIdentity(input)
  return state.applyRuntimeMetadata(input) || identityChanged
}

describe('TerminalSessionState', () => {
  test('owns Composer mode, expansion, verbatim draft, and bounded immutable history', () => {
    const state = new TerminalSessionState()
    const initialHistory = state.snapshot(null).composer.historyEntries

    expect(state.closeComposer()).toBe(false)
    expect(state.openComposer()).toBe(true)
    expect(state.setComposerMode('input')).toBe(false)
    expect(state.setComposerMode('keys')).toBe(true)
    expect(state.openComposer()).toBe(true)
    expect(state.openComposer()).toBe(false)
    expect(state.setComposerDraft('line one\r\nline two')).toBe(true)
    expect(state.setComposerDraft('line one\r\nline two')).toBe(false)
    expect(state.replaceComposerDraft('different draft', '')).toBe(false)
    expect(state.snapshot(null).composer.draft).toBe('line one\r\nline two')
    expect(state.replaceComposerDraft('line one\r\nline two', 'replacement')).toBe(true)
    expect(state.recordComposerHistory('')).toBe(false)

    for (let index = 0; index < 51; index += 1) {
      expect(state.recordComposerHistory(`command ${index}`)).toBe(true)
    }
    expect(state.recordComposerHistory('command 50')).toBe(false)

    const composer = state.snapshot(null).composer
    expect(composer.expanded).toBe(true)
    expect(composer.mode).toBe('input')
    expect(composer.draft).toBe('replacement')
    expect(composer.historyEntries).not.toBe(initialHistory)
    expect(composer.historyEntries).toHaveLength(50)
    expect(composer.historyEntries[0]).toBe('command 1')
    expect(composer.historyEntries.at(-1)).toBe('command 50')
    expect(state.snapshot(null).composer.historyEntries).toBe(composer.historyEntries)
  })

  test('keeps Composer facts isolated between logical client sessions', () => {
    const first = new TerminalSessionState()
    const second = new TerminalSessionState()

    first.openComposer()
    first.setComposerMode('keys')
    first.setComposerDraft('first session draft')
    first.recordComposerHistory('first session only')

    expect(first.snapshot(null).composer).toEqual({
      expanded: true,
      mode: 'keys',
      draft: 'first session draft',
      historyEntries: ['first session only'],
    })
    expect(second.snapshot(null).composer).toEqual(DEFAULT_COMPOSER)
  })

  test('closes without replacing retained state and reopens in input mode', () => {
    const state = new TerminalSessionState()
    state.openComposer()
    state.setComposerMode('keys')
    state.setComposerDraft('retained draft')

    expect(state.closeComposer()).toBe(true)
    expect(state.closeComposer()).toBe(false)
    expect(state.snapshot(null).composer).toEqual({
      expanded: false,
      mode: 'keys',
      draft: 'retained draft',
      historyEntries: [],
    })
    expect(state.openComposer()).toBe(true)
    expect(state.snapshot(null).composer).toEqual({
      expanded: true,
      mode: 'input',
      draft: 'retained draft',
      historyEntries: [],
    })
  })

  test('initial state has the opening phase, default process name, and no attachment', () => {
    const state = new TerminalSessionState()
    expect(state.snapshot(null)).toEqual({
      phase: 'opening',
      message: null,
      processName: 'terminal',
      canonicalTitle: null,
      composer: DEFAULT_COMPOSER,
    })
    // An unbound runtime passes null. Once a runtime id is addressable, its
    // control identity remains orthogonal to lifecycle.
    expect(state.snapshot('pty_session_1_aaaaaaaaa').attachment).toEqual({ role: 'controller' })
  })

  test('identity and runtime metadata produce an open snapshot', () => {
    const state = new TerminalSessionState()
    expect(
      applyIdentityAndRuntimeMetadataForTest(state, {
        processName: 'zsh',
        canonicalTitle: '~/Developer/goblin — npm run dev',
        identityRevision: 0,
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalSize: { cols: 120, rows: 40 },
      }),
    ).toBe(true)
    // The default phase is 'open' for an attach/restart metadata payload.
    expect(state.snapshot(null).phase).toBe('open')
    // The attachment carries identity fields only — no phase.
    expect(state.snapshot('pty_session_1_aaaaaaaaa')).toEqual({
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      composer: DEFAULT_COMPOSER,
      attachment: {
        role: 'viewer',
      },
    })
  })

  test('applyIdentity does not touch lifecycle; applyLifecycle does not touch identity', () => {
    // The split is the architectural contract: an identity event
    // updates role/controllerStatus/canonicalSize and returns
    // `changed` only for those fields. A lifecycle event updates
    // phase/message and returns `changed` only for
    // those fields. A future caller cannot accidentally re-introduce
    // the conflation because the types do not overlap.
    const state = new TerminalSessionState()
    applyIdentityAndRuntimeMetadataForTest(state, {
      processName: 'zsh',
      canonicalTitle: null,
      identityRevision: 0,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    // Identity-only update: phase is unchanged.
    const identityOnly: TerminalIdentityViewModel = {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    }
    expect(state.applyIdentity(identityOnly)).toEqual({ accepted: true, changed: true })
    expect(state.getPhase()).toBe('open')
    expect(state.getClientController().role).toBe('viewer')

    // Lifecycle-only update: role is unchanged.
    const lifecycleOnly: TerminalLifecycleViewModel = {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'opening',
      message: 'restarting',
    }
    expect(state.applyLifecycle(lifecycleOnly)).toBe(true)
    expect(state.getPhase()).toBe('opening')
    expect(state.getClientController().role).toBe('viewer')
  })

  test('isController reflects role only — a transitional phase does not flip it', () => {
    // The split: `isController` is the role-only controller predicate the
    // teardown decision uses. A `canSendInput` (which adds the phase
    // requirement) is the write-path gate. They are intentionally
    // separate so the conflation in the pre-split `canResize()` is
    // not possible.
    const state = new TerminalSessionState()
    applyIdentityAndRuntimeMetadataForTest(state, {
      processName: 'zsh',
      canonicalTitle: null,
      identityRevision: 0,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(state.isController()).toBe(true)
    expect(state.canSendInput()).toBe(true)

    // Move to a transitional phase but keep the controller role.
    state.applyLifecycle({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'opening',
      message: null,
    })
    expect(state.isController()).toBe(true) // Role-only — still controller.
    expect(state.canSendInput()).toBe(false) // Write-path — phase is transitional.
  })

  test('canSendInput requires both role=controller AND phase=open', () => {
    const state = new TerminalSessionState()
    applyIdentityAndRuntimeMetadataForTest(state, {
      processName: 'zsh',
      canonicalTitle: null,
      identityRevision: 0,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    // Viewer cannot send input regardless of phase.
    expect(state.canSendInput()).toBe(false)
    state.applyLifecycle({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
    })
    expect(state.canSendInput()).toBe(false)

    // Controller can send input only when phase is 'open'.
    state.applyIdentity({
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(state.canSendInput()).toBe(true)

    state.applyLifecycle({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'restarting',
      message: null,
    })
    expect(state.canSendInput()).toBe(false)
  })

  test('applyIdentity is order-independent with applyLifecycle', () => {
    // The split is order-independent: applying lifecycle first and
    // identity second produces the same state as the reverse order,
    // as long as the final values are the same. This pins the
    // contract that the two sub-states do not interact.
    const identity: TerminalIdentityViewModel = {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    }
    const lifecycle: TerminalLifecycleViewModel = {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
    }

    const a = new TerminalSessionState()
    a.applyIdentity(identity)
    a.applyLifecycle(lifecycle)

    const b = new TerminalSessionState()
    b.applyLifecycle(lifecycle)
    b.applyIdentity(identity)

    expect(a.snapshot('pty_session_1_aaaaaaaaa')).toEqual(b.snapshot('pty_session_1_aaaaaaaaa'))
  })

  test('restarting state is non-interactive until open resumes', () => {
    const state = new TerminalSessionState()
    applyIdentityAndRuntimeMetadataForTest(state, {
      processName: 'zsh',
      canonicalTitle: null,
      identityRevision: 0,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    expect(state.snapshot('pty_session_1_aaaaaaaaa').attachment).toEqual({ role: 'controller' })
    expect(
      state.applyLifecycle({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        phase: 'restarting',
        message: null,
      }),
    ).toBe(true)
    expect(state.canSendInput()).toBe(false)
    expect(state.snapshot('pty_session_1_aaaaaaaaa')).toEqual({
      phase: 'restarting',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      composer: DEFAULT_COMPOSER,
      attachment: { role: 'controller' },
    })
  })

  test('resetTransientState clears transient state without overwriting identity or lifecycle', () => {
    const state = new TerminalSessionState()
    applyIdentityAndRuntimeMetadataForTest(state, {
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      identityRevision: 0,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    state.beginReplay({ seq: 1 })
    state.captureReplayOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'live',
      seq: 2,
      processName: 'zsh',
    })
    state.setSearchResult({ resultIndex: 0, resultCount: 1, found: true })
    state.setProgress(1, 10)
    state.openComposer()
    state.setComposerMode('input')
    state.recordComposerHistory('kept command')

    expect(state.resetTransientState()).toBe(true)
    // Identity and lifecycle survive `resetTransientState` — only
    // the replay buffer, search result, and progress are wiped.
    expect(state.snapshot('pty_session_1_aaaaaaaaa')).toEqual({
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      composer: { expanded: true, mode: 'input', draft: '', historyEntries: ['kept command'] },
      attachment: {
        role: 'viewer',
      },
    })
  })

  test('clamps progress values at the state boundary', () => {
    const state = new TerminalSessionState()

    expect(state.setProgress(1, 150)).toBe(true)
    expect(state.snapshot(null).progress).toEqual({ state: 1, value: 100 })
    expect(state.setProgress(1, -10)).toBe(true)
    expect(state.snapshot(null).progress).toEqual({ state: 1, value: 0 })
  })

  test('normalizes empty titles back to null', () => {
    const state = new TerminalSessionState()

    expect(state.setCanonicalTitle('  hello   world  ')).toBe(true)
    expect(state.snapshot(null).canonicalTitle).toBe('hello world')
    expect(state.setCanonicalTitle('   ')).toBe(true)
    expect(state.snapshot(null).canonicalTitle).toBeNull()
  })

  test('rejects stale identity, accepts an idempotent replay, and fast-fails an equal-revision conflict', () => {
    const state = new TerminalSessionState()
    applyIdentityAndRuntimeMetadataForTest(state, {
      processName: 'zsh',
      canonicalTitle: null,
      identityRevision: 0,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    const current = {
      identityRevision: 2,
      role: 'viewer' as const,
      controllerStatus: 'connected' as const,
      canonicalSize: { cols: 120, rows: 40 },
    }

    expect(state.applyIdentity(current)).toEqual({ accepted: true, changed: true })
    expect(
      state.applyIdentity({
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      }),
    ).toEqual({ accepted: false, changed: false })
    expect(state.applyIdentity(current)).toEqual({ accepted: true, changed: false })
    expect(() => state.applyIdentity({ ...current, role: 'controller' })).toThrow(
      'terminal identity payload conflicts at the same revision',
    )
    expect(state.getClientController().role).toBe('viewer')
    expect(state.getCanonicalSize()).toEqual({ cols: 120, rows: 40 })
  })
})
