import { describe, expect, test } from 'vitest'
import { TerminalSessionState } from '#/web/components/terminal/terminal-session-state.ts'
import type { TerminalIdentityViewModel, TerminalLifecycleViewModel } from '#/web/components/terminal/types.ts'

describe('TerminalSessionState', () => {
  test('initial state has the opening phase, default process name, and no attachment', () => {
    const state = new TerminalSessionState()
    expect(state.snapshot(null)).toEqual({
      phase: 'opening',
      message: null,
      processName: 'terminal',
      canonicalTitle: null,
    })
    // No attachment is published until a ptySessionId is set AND
    // the phase is 'open'. The contract is the same as before the
    // identity/lifecycle split: the public snapshot surfaces the
    // attachment only on the open state.
    expect(state.snapshot('pty_session_1_aaaaaaaaa').attachment).toBeUndefined()
  })

  test('applyOpenResult sets identity and lifecycle in one shot', () => {
    const state = new TerminalSessionState()
    expect(
      state.applyOpenResult({
        processName: 'zsh',
        canonicalTitle: '~/Developer/goblin — npm run dev',
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    ).toBe(true)
    // The default phase is 'open' for a first-frame payload.
    expect(state.setOpen()).toBe(false)
    // The attachment carries identity fields only — no phase.
    expect(state.snapshot('pty_session_1_aaaaaaaaa')).toEqual({
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      attachment: {
        role: 'viewer',
        controllerStatus: 'connected',
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
      },
    })
  })

  test('applyIdentity does not touch lifecycle; applyLifecycle does not touch identity', () => {
    // The split is the architectural contract: an identity event
    // updates role/controllerStatus/canonicalSize and returns
    // `changed` only for those fields. A lifecycle event updates
    // phase/message/takeoverPending and returns `changed` only for
    // those fields. A future caller cannot accidentally re-introduce
    // the conflation because the types do not overlap.
    const state = new TerminalSessionState()
    state.applyOpenResult({
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    })

    // Identity-only update: phase is unchanged.
    const identityOnly: TerminalIdentityViewModel = {
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    }
    expect(state.applyIdentity(identityOnly)).toBe(true)
    expect(state.getPhase()).toBe('open')
    expect(state.getClientController().role).toBe('viewer')

    // Lifecycle-only update: role is unchanged.
    const lifecycleOnly: TerminalLifecycleViewModel = {
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'opening',
      message: 'restarting',
      takeoverPending: true,
    }
    expect(state.applyLifecycle(lifecycleOnly)).toBe(true)
    expect(state.getPhase()).toBe('opening')
    expect(state.getClientController().role).toBe('viewer')
    expect(state.isTakeoverPending()).toBe(true)
  })

  test('isController reflects role only — a transitional phase does not flip it', () => {
    // The split: `isController` is the role-only controller predicate the
    // teardown decision uses. A `canSendInput` (which adds the phase
    // requirement) is the write-path gate. They are intentionally
    // separate so the conflation in the pre-split `canResize()` is
    // not possible.
    const state = new TerminalSessionState()
    state.applyOpenResult({
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    })
    expect(state.isController()).toBe(true)
    expect(state.canSendInput()).toBe(true)

    // Move to a transitional phase but keep the controller role.
    state.applyLifecycle({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'opening',
      message: null,
      takeoverPending: false,
    })
    expect(state.isController()).toBe(true) // Role-only — still controller.
    expect(state.canSendInput()).toBe(false) // Write-path — phase is transitional.
  })

  test('canSendInput requires both role=controller AND phase=open', () => {
    const state = new TerminalSessionState()
    state.applyOpenResult({
      processName: 'zsh',
      canonicalTitle: null,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    })
    // Viewer cannot send input regardless of phase.
    expect(state.canSendInput()).toBe(false)
    state.applyLifecycle({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'open',
      message: null,
      takeoverPending: false,
    })
    expect(state.canSendInput()).toBe(false)

    // Controller can send input only when phase is 'open'.
    state.applyIdentity({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    })
    expect(state.canSendInput()).toBe(true)

    state.applyLifecycle({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'restarting',
      message: null,
      takeoverPending: false,
    })
    expect(state.canSendInput()).toBe(false)
  })

  test('applyIdentity is order-independent with applyLifecycle', () => {
    // The split is order-independent: applying lifecycle first and
    // identity second produces the same state as the reverse order,
    // as long as the final values are the same. This pins the
    // contract that the two sub-states do not interact.
    const identity: TerminalIdentityViewModel = {
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    }
    const lifecycle: TerminalLifecycleViewModel = {
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'open',
      message: null,
      takeoverPending: false,
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
    state.applyOpenResult({
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    expect(state.snapshot('pty_session_1_aaaaaaaaa').attachment?.active).toBe(true)
    expect(state.setRestarting()).toBe(true)
    // When the phase leaves 'open', the attachment is removed from
    // the snapshot — even though the role is still 'controller'.
    // The client reads the role from the (no longer published)
    // attachment only when phase is 'open'.
    expect(state.snapshot('pty_session_1_aaaaaaaaa')).toEqual({
      phase: 'restarting',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
    })
  })

  test('resetTransientState clears transient state without overwriting identity or lifecycle', () => {
    const state = new TerminalSessionState()
    state.applyOpenResult({
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    state.setOpen()
    state.beginReplay(1)
    state.captureReplayOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'live', seq: 2, processName: 'zsh' })
    state.setSearchResult({ resultIndex: 0, resultCount: 1, found: true })
    state.setProgress(1, 10)

    expect(state.resetTransientState()).toBe(true)
    // Identity and lifecycle survive `resetTransientState` — only
    // the replay buffer, search result, and progress are wiped.
    expect(state.snapshot('pty_session_1_aaaaaaaaa')).toEqual({
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      attachment: {
        role: 'viewer',
        controllerStatus: 'connected',
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
      },
    })
  })

  test('normalizes empty titles back to null', () => {
    const state = new TerminalSessionState()

    expect(state.setCanonicalTitle('  hello   world  ')).toBe(true)
    expect(state.snapshot(null).canonicalTitle).toBe('hello world')
    expect(state.setCanonicalTitle('   ')).toBe(true)
    expect(state.snapshot(null).canonicalTitle).toBeNull()
  })
})
