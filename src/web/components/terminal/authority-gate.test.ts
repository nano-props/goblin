// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalTakeoverInput, TerminalTakeoverResult } from '#/shared/terminal-types.ts'
import { createXtermAuthorityGate } from '#/web/components/terminal/authority-gate.ts'
import { terminalLog } from '#/web/logger.ts'
import type { RendererTerminalBridge } from '#/web/client-bridge-types.ts'

// Focused unit tests for the AuthorityGate. The gate is the single
// source of truth for write-side authorization, so its decision
// branches and ordering contracts are pinned here without booting a
// full ManagedTerminalSlot.

function makeBridge(
  takeoverImpl?: (input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>,
): RendererTerminalBridge {
  return {
    takeover: takeoverImpl
      ? vi.fn<RendererTerminalBridge['takeover']>(takeoverImpl)
      : vi.fn<RendererTerminalBridge['takeover']>(),
  } as unknown as RendererTerminalBridge
}

function successResult(ptySessionId: string, clientId = 'client_local'): TerminalTakeoverResult {
  return {
    ok: true,
    ptySessionId,
    role: 'controller',
    controllerStatus: 'connected',
    controller: { clientId, status: 'connected' },
    canonicalCols: 80,
    canonicalRows: 24,
    phase: 'open',
  }
}

interface GateHarness {
  bridge: RendererTerminalBridge
  gate: ReturnType<typeof createXtermAuthorityGate>
  promoted: ReturnType<typeof vi.fn>
  isSessionAlive: ReturnType<typeof vi.fn>
}

function buildGate(overrides: {
  takeoverImpl?: (input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>
  isSessionAlive?: (ptySessionId: string) => boolean
  getPtySessionId?: () => string | null
} = {}): GateHarness {
  const bridge = makeBridge(overrides.takeoverImpl)
  const promoted = vi.fn()
  const isSessionAlive = vi.fn(overrides.isSessionAlive ?? (() => true))
  const getPtySessionId = overrides.getPtySessionId ?? (() => 'pty_session_1_aaaaaaaaa')
  const gate = createXtermAuthorityGate({
    bridge,
    resolveSize: async () => ({ cols: 80, rows: 24 }),
    isSessionAlive,
    getPtySessionId,
    onPromoted: promoted,
  })
  return { bridge, gate, promoted, isSessionAlive }
}

beforeEach(() => {
  // Pin the attachment id so the takeover input is deterministic
  // across tests. The real `readOrCreateWebTerminalClientId`
  // reads `window.sessionStorage`, which the global vitest setup
  // already shimmed with an in-memory Storage.
  window.sessionStorage.setItem('goblin:web-terminal-client-id', 'client_local')
  vi.clearAllMocks()
})

describe('AuthorityGate cached role', () => {
  test('starts unowned and reports the cached role through currentRole', () => {
    const { gate } = buildGate()
    expect(gate.currentRole()).toBe('unowned')
    expect(gate.isController()).toBe(false)
    expect(gate.canWrite()).toBe(false)
  })

  test('setRole updates isController, canWrite, and currentRole consistently', () => {
    const { gate } = buildGate()
    gate.setRole('viewer')
    expect(gate.currentRole()).toBe('viewer')
    expect(gate.isController()).toBe(false)
    expect(gate.canWrite()).toBe(true) // viewer is allowed to write (auto-promote path)
    gate.setRole('controller')
    expect(gate.currentRole()).toBe('controller')
    expect(gate.isController()).toBe(true)
    expect(gate.canWrite()).toBe(true)
    gate.setRole('unowned')
    expect(gate.currentRole()).toBe('unowned')
    expect(gate.isController()).toBe(false)
    expect(gate.canWrite()).toBe(false)
  })
})

describe('AuthorityGate.authorize', () => {
  test('controller role returns allowed without hitting the bridge', async () => {
    const { gate, bridge } = buildGate()
    gate.setRole('controller')
    const result = await gate.authorize('write')
    expect(result).toEqual({ kind: 'allowed' })
    expect(bridge.takeover).not.toHaveBeenCalled()
  })

  test('viewer role fires a takeover and returns promoted on success', async () => {
    const { gate, bridge, promoted } = buildGate({
      takeoverImpl: async () => successResult('pty_session_1_aaaaaaaaa'),
    })
    gate.setRole('viewer')
    const result = await gate.authorize('resize')
    expect(result).toEqual({ kind: 'promoted' })
    expect(bridge.takeover).toHaveBeenCalledTimes(1)
    expect(promoted).toHaveBeenCalledTimes(1)
    // After the promote, the gate now reports controller — that's
    // what lets the caller retry / proceed without a second round-trip.
    expect(gate.isController()).toBe(true)
  })

  test('unowned role short-circuits with slot-closed and never touches the bridge', async () => {
    const { gate, bridge } = buildGate()
    // role is 'unowned' by default
    const result = await gate.authorize('write')
    expect(result).toEqual({ kind: 'denied', reason: 'slot-closed' })
    expect(bridge.takeover).not.toHaveBeenCalled()
  })

  test('viewer takeover-rejected surfaces takeover-rejected without flipping role', async () => {
    const { gate, bridge, promoted } = buildGate({
      takeoverImpl: async () => ({ ok: false, message: 'rejected' }),
    })
    gate.setRole('viewer')
    const result = await gate.authorize('write')
    // The server message is now propagated through the gate so the
    // caller (or its logs) can correlate the failure with the
    // server's i18n key. 'rejected' is not a known server key, so
    // the classifier falls through to the catch-all reason.
    expect(result).toEqual({ kind: 'denied', reason: 'takeover-rejected', message: 'rejected' })
    expect(bridge.takeover).toHaveBeenCalledTimes(1)
    expect(promoted).not.toHaveBeenCalled()
    expect(gate.currentRole()).toBe('viewer')
  })
})

describe('AuthorityGate.takeover (explicit button path)', () => {
  test('returns allowed and flips role to controller on success', async () => {
    const { gate, promoted } = buildGate({
      takeoverImpl: async () => successResult('pty_session_1_aaaaaaaaa'),
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({ kind: 'allowed' })
    expect(gate.currentRole()).toBe('controller')
    expect(promoted).toHaveBeenCalledTimes(1)
  })

  test('returns slot-closed when the session id is null', async () => {
    const { gate, bridge } = buildGate({ getPtySessionId: () => null })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({ kind: 'denied', reason: 'slot-closed' })
    expect(bridge.takeover).not.toHaveBeenCalled()
  })

  test('returns slot-closed when the session was disposed mid-call', async () => {
    const { gate, bridge, isSessionAlive, promoted } = buildGate({
      isSessionAlive: () => false,
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({ kind: 'denied', reason: 'slot-closed' })
    expect(bridge.takeover).not.toHaveBeenCalled()
    expect(isSessionAlive).toHaveBeenCalledWith('pty_session_1_aaaaaaaaa')
    expect(promoted).not.toHaveBeenCalled()
  })

  test('returns takeover-rejected when resolveSize throws and does not call the bridge', async () => {
    const bridge2 = makeBridge()
    const gate2 = createXtermAuthorityGate({
      bridge: bridge2,
      resolveSize: async () => {
        throw new Error('measurement failed')
      },
      isSessionAlive: () => true,
      getPtySessionId: () => 'pty_session_1_aaaaaaaaa',
      onPromoted: vi.fn(),
    })
    gate2.setRole('viewer')
    const result = await gate2.takeover()
    expect(result).toEqual({ kind: 'denied', reason: 'takeover-rejected' })
    expect(bridge2.takeover).not.toHaveBeenCalled()
  })

  test('returns no-bridge when the bridge call throws synchronously', async () => {
    const bridge = makeBridge()
    ;(bridge.takeover as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ipc blew up')
    })
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => ({ cols: 80, rows: 24 }),
      isSessionAlive: () => true,
      getPtySessionId: () => 'pty_session_1_aaaaaaaaa',
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({ kind: 'denied', reason: 'no-bridge' })
    expect(gate.currentRole()).toBe('viewer')
  })

  test('classifies error.unavailable as client-offline', async () => {
    const { gate } = buildGate({
      takeoverImpl: async () => ({ ok: false, message: 'error.unavailable' }),
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({
      kind: 'denied',
      reason: 'client-offline',
      message: 'error.unavailable',
    })
    expect(gate.currentRole()).toBe('viewer')
  })

  test('classifies error.invalid-arguments as session-unknown', async () => {
    const { gate } = buildGate({
      takeoverImpl: async () => ({ ok: false, message: 'error.invalid-arguments' }),
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({
      kind: 'denied',
      reason: 'session-unknown',
      message: 'error.invalid-arguments',
    })
    expect(gate.currentRole()).toBe('viewer')
  })

  test('classifies an unknown server message as takeover-rejected', async () => {
    const { gate } = buildGate({
      takeoverImpl: async () => ({ ok: false, message: 'error.something-new' }),
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({
      kind: 'denied',
      reason: 'takeover-rejected',
      message: 'error.something-new',
    })
  })
})

describe('AuthorityGate synchronous getPtySessionId + isSessionAlive contract', () => {
  // The gate's `doTakeover` captures `getPtySessionId()` then immediately
  // calls `isSessionAlive(ptySessionId)` before any await. This is a
  // load-bearing ordering: the two synchronous calls must see the
  // same closure state, otherwise a rehydrate that lands between
  // them would let a takeover round-trip fire against a stale
  // ptySessionId. The two tests below exercise that ordering.
  test('short-circuits when ptySessionId is captured but no longer alive by isSessionAlive (rehydrate race)', async () => {
    // Simulate a rehydrate that swaps the live ptySessionId the instant
    // getPtySessionId returns. The next closure call (`isSessionAlive`)
    // sees the post-rehydrate value and returns false.
    let liveId: string = 'pty_session_1_aaaaaaaaa'
    const bridge = makeBridge(async () => successResult('pty_session_1_aaaaaaaaa'))
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => ({ cols: 80, rows: 24 }),
      isSessionAlive: (id) => liveId === id,
      getPtySessionId: () => {
        const captured = liveId
        liveId = 'pty_session_2_aaaaaaaaa'
        return captured
      },
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({ kind: 'denied', reason: 'slot-closed' })
    expect(bridge.takeover).not.toHaveBeenCalled()
  })

  test('does not short-circuit when both getPtySessionId and isSessionAlive observe the same ptySessionId', async () => {
    const bridge = makeBridge(async () => successResult('pty_session_1_aaaaaaaaa'))
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => ({ cols: 80, rows: 24 }),
      isSessionAlive: () => true,
      getPtySessionId: () => 'pty_session_1_aaaaaaaaa',
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    const result = await gate.takeover()
    expect(result).toEqual({ kind: 'allowed' })
    expect(bridge.takeover).toHaveBeenCalledTimes(1)
  })
})

describe('AuthorityGate ordering contract', () => {
  test('onPromoted runs synchronously before role flips to controller', async () => {
    const callOrder: string[] = []
    const bridge = makeBridge(async () => {
      callOrder.push('bridge-resolved')
      return successResult('pty_session_1_aaaaaaaaa')
    })
    const onPromoted = vi.fn(() => {
      callOrder.push('onPromoted')
    })
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => {
        callOrder.push('resolveSize')
        return { cols: 80, rows: 24 }
      },
      isSessionAlive: () => true,
      getPtySessionId: () => 'pty_session_1_aaaaaaaaa',
      onPromoted,
    })
    gate.setRole('viewer')
    // Pre-call: gate is a viewer.
    expect(gate.isController()).toBe(false)
    const result = await gate.takeover()
    expect(result).toEqual({ kind: 'allowed' })
    // The takeover contract for callers (e.g. ManagedTerminalSlot
    // uses wasController then runtime.canResize()) requires
    // onPromoted → role='controller' to be observable as soon as
    // the returned promise resolves. Both layers must agree by the
    // time the await returns.
    expect(callOrder).toEqual(['resolveSize', 'bridge-resolved', 'onPromoted'])
    expect(gate.isController()).toBe(true)
    expect(onPromoted).toHaveBeenCalledTimes(1)
  })

  test('forwards the session id, resolved size, and attachment id to the bridge', async () => {
    const bridge = makeBridge(async () => successResult('pty_session_1_aaaaaaaaa'))
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => ({ cols: 132, rows: 50 }),
      isSessionAlive: () => true,
      getPtySessionId: () => 'session-xyz',
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    await gate.takeover()
    expect(bridge.takeover).toHaveBeenCalledWith({
      ptySessionId: 'session-xyz',
      cols: 132,
      rows: 50,
      clientId: 'client_local',
    })
  })
})

describe('AuthorityGate single-emit deny log', () => {
  // Every deny path (gate-internal and server-side) goes through
  // the same `deny()` helper so a future denial can't silently skip
  // the diagnostic. The session layer no longer double-logs — the
  // gate is the single source of truth for takeover-failure logs.
  // These tests pin that contract: one warn per deny, tagged with
  // the pipeline stage that produced it.
  test('preflight deny (null ptySessionId) logs with stage=preflight', async () => {
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const { gate } = buildGate({ getPtySessionId: () => null })
    gate.setRole('viewer')
    await gate.takeover()
    expect(warnSpy).toHaveBeenCalledWith(
      'authority gate: takeover denied',
      expect.objectContaining({ reason: 'slot-closed', stage: 'preflight' }),
    )
    warnSpy.mockRestore()
  })

  test('isSessionAlive deny logs with stage=isSessionAlive', async () => {
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const { gate } = buildGate({ isSessionAlive: () => false })
    gate.setRole('viewer')
    await gate.takeover()
    expect(warnSpy).toHaveBeenCalledWith(
      'authority gate: takeover denied',
      expect.objectContaining({ reason: 'slot-closed', stage: 'isSessionAlive', ptySessionId: 'pty_session_1_aaaaaaaaa' }),
    )
    warnSpy.mockRestore()
  })

  test('resolveSize throw logs with stage=resolveSize', async () => {
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const gate = createXtermAuthorityGate({
      bridge: makeBridge(),
      resolveSize: async () => {
        throw new Error('measurement failed')
      },
      isSessionAlive: () => true,
      getPtySessionId: () => 'pty_session_1_aaaaaaaaa',
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    await gate.takeover()
    expect(warnSpy).toHaveBeenCalledWith(
      'authority gate: takeover denied',
      expect.objectContaining({ reason: 'takeover-rejected', stage: 'resolveSize' }),
    )
    warnSpy.mockRestore()
  })

  test('bridge throw logs with stage=bridge and reason=no-bridge', async () => {
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const bridge = makeBridge()
    ;(bridge.takeover as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ipc blew up')
    })
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => ({ cols: 80, rows: 24 }),
      isSessionAlive: () => true,
      getPtySessionId: () => 'pty_session_1_aaaaaaaaa',
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    await gate.takeover()
    expect(warnSpy).toHaveBeenCalledWith(
      'authority gate: takeover denied',
      expect.objectContaining({ reason: 'no-bridge', stage: 'bridge' }),
    )
    warnSpy.mockRestore()
  })

  test('server rejection logs with stage=server and propagates the i18n message', async () => {
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const { gate } = buildGate({
      takeoverImpl: async () => ({ ok: false, message: 'error.unavailable' }),
    })
    gate.setRole('viewer')
    await gate.takeover()
    expect(warnSpy).toHaveBeenCalledWith(
      'authority gate: takeover denied',
      expect.objectContaining({
        reason: 'client-offline',
        stage: 'server',
        message: 'error.unavailable',
        ptySessionId: 'pty_session_1_aaaaaaaaa',
      }),
    )
    warnSpy.mockRestore()
  })
})