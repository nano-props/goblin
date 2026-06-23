// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalTakeoverInput, TerminalTakeoverResult } from '#/shared/terminal-types.ts'
import { createXtermAuthorityGate } from '#/web/components/terminal/authority-gate.ts'
import type { RendererTerminalBridge } from '#/web/renderer-bridge-types.ts'

// Focused unit tests for the AuthorityGate. The gate is the single
// source of truth for write-side authorization, so its decision
// branches and ordering contracts are pinned here without booting a
// full ManagedTerminalSession.

function makeBridge(
  takeoverImpl?: (input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>,
): RendererTerminalBridge {
  return {
    takeover: takeoverImpl
      ? vi.fn<RendererTerminalBridge['takeover']>(takeoverImpl)
      : vi.fn<RendererTerminalBridge['takeover']>(),
  } as unknown as RendererTerminalBridge
}

function successResult(sessionId: string, attachmentId = 'attachment_local'): TerminalTakeoverResult {
  return {
    ok: true,
    sessionId,
    role: 'controller',
    controllerStatus: 'connected',
    controller: { attachmentId, status: 'connected' },
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
  isSessionAlive?: (sessionId: string) => boolean
  getSessionId?: () => string | null
} = {}): GateHarness {
  const bridge = makeBridge(overrides.takeoverImpl)
  const promoted = vi.fn()
  const isSessionAlive = vi.fn(overrides.isSessionAlive ?? (() => true))
  const getSessionId = overrides.getSessionId ?? (() => 'session-1')
  const gate = createXtermAuthorityGate({
    bridge,
    resolveSize: async () => ({ cols: 80, rows: 24 }),
    isSessionAlive,
    getSessionId,
    onPromoted: promoted,
  })
  return { bridge, gate, promoted, isSessionAlive }
}

beforeEach(() => {
  // Pin the attachment id so the takeover input is deterministic
  // across tests. The real `readOrCreateWebTerminalAttachmentId`
  // reads `window.sessionStorage`, which the global vitest setup
  // already shimmed with an in-memory Storage.
  window.sessionStorage.setItem('goblin:web-terminal-attachment-id', 'attachment_local')
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
      takeoverImpl: async () => successResult('session-1'),
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

  test('unowned role short-circuits with session-closed and never touches the bridge', async () => {
    const { gate, bridge } = buildGate()
    // role is 'unowned' by default
    const result = await gate.authorize('write')
    expect(result).toEqual({ kind: 'denied', reason: 'session-closed' })
    expect(bridge.takeover).not.toHaveBeenCalled()
  })

  test('viewer takeover-rejected surfaces takeover-rejected without flipping role', async () => {
    const { gate, bridge, promoted } = buildGate({
      takeoverImpl: async () => ({ ok: false, message: 'rejected' }),
    })
    gate.setRole('viewer')
    const result = await gate.authorize('write')
    expect(result).toEqual({ kind: 'denied', reason: 'takeover-rejected' })
    expect(bridge.takeover).toHaveBeenCalledTimes(1)
    expect(promoted).not.toHaveBeenCalled()
    expect(gate.currentRole()).toBe('viewer')
  })
})

describe('AuthorityGate.takeover (explicit button path)', () => {
  test('returns true and flips role to controller on success', async () => {
    const { gate, promoted } = buildGate({
      takeoverImpl: async () => successResult('session-1'),
    })
    gate.setRole('viewer')
    const ok = await gate.takeover()
    expect(ok).toBe(true)
    expect(gate.currentRole()).toBe('controller')
    expect(promoted).toHaveBeenCalledTimes(1)
  })

  test('returns false when the session id is null', async () => {
    const { gate, bridge } = buildGate({ getSessionId: () => null })
    gate.setRole('viewer')
    const ok = await gate.takeover()
    expect(ok).toBe(false)
    expect(bridge.takeover).not.toHaveBeenCalled()
  })

  test('returns false when the session was disposed mid-call', async () => {
    const { gate, bridge, isSessionAlive, promoted } = buildGate({
      isSessionAlive: () => false,
    })
    gate.setRole('viewer')
    const ok = await gate.takeover()
    expect(ok).toBe(false)
    expect(bridge.takeover).not.toHaveBeenCalled()
    expect(isSessionAlive).toHaveBeenCalledWith('session-1')
    expect(promoted).not.toHaveBeenCalled()
  })

  test('returns false when resolveSize throws and does not call the bridge', async () => {
    const { gate, bridge } = buildGate()
    gate.setRole('viewer')
    // Replace resolveSize via a fresh gate; the factory above gives
    // us a working resolveSize, so build a new harness.
    const bridge2 = makeBridge()
    const gate2 = createXtermAuthorityGate({
      bridge: bridge2,
      resolveSize: async () => {
        throw new Error('measurement failed')
      },
      isSessionAlive: () => true,
      getSessionId: () => 'session-1',
      onPromoted: vi.fn(),
    })
    gate2.setRole('viewer')
    const ok = await gate2.takeover()
    expect(ok).toBe(false)
    expect(bridge2.takeover).not.toHaveBeenCalled()
  })

  test('returns false when the bridge call throws synchronously', async () => {
    const bridge = makeBridge()
    ;(bridge.takeover as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ipc blew up')
    })
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => ({ cols: 80, rows: 24 }),
      isSessionAlive: () => true,
      getSessionId: () => 'session-1',
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    const ok = await gate.takeover()
    expect(ok).toBe(false)
    expect(gate.currentRole()).toBe('viewer')
  })

  test('returns false when the bridge rejects with ok:false', async () => {
    const { gate } = buildGate({
      takeoverImpl: async () => ({ ok: false, message: 'no controller seat for you' }),
    })
    gate.setRole('viewer')
    const ok = await gate.takeover()
    expect(ok).toBe(false)
    expect(gate.currentRole()).toBe('viewer')
  })
})

describe('AuthorityGate ordering contract', () => {
  test('onPromoted runs synchronously before role flips to controller', async () => {
    const callOrder: string[] = []
    const bridge = makeBridge(async () => {
      callOrder.push('bridge-resolved')
      return successResult('session-1')
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
      getSessionId: () => 'session-1',
      onPromoted,
    })
    gate.setRole('viewer')
    // Pre-call: gate is a viewer.
    expect(gate.isController()).toBe(false)
    const ok = await gate.takeover()
    expect(ok).toBe(true)
    // The takeover contract for callers (e.g. ManagedTerminalSession
    // uses wasController then runtime.canResize()) requires
    // onPromoted → role='controller' to be observable as soon as
    // the returned promise resolves. Both layers must agree by the
    // time the await returns.
    expect(callOrder).toEqual(['resolveSize', 'bridge-resolved', 'onPromoted'])
    expect(gate.isController()).toBe(true)
    expect(onPromoted).toHaveBeenCalledTimes(1)
  })

  test('forwards the session id, resolved size, and attachment id to the bridge', async () => {
    const bridge = makeBridge(async () => successResult('session-1'))
    const gate = createXtermAuthorityGate({
      bridge,
      resolveSize: async () => ({ cols: 132, rows: 50 }),
      isSessionAlive: () => true,
      getSessionId: () => 'session-xyz',
      onPromoted: vi.fn(),
    })
    gate.setRole('viewer')
    await gate.takeover()
    expect(bridge.takeover).toHaveBeenCalledWith({
      sessionId: 'session-xyz',
      cols: 132,
      rows: 50,
      attachmentId: 'attachment_local',
    })
  })
})