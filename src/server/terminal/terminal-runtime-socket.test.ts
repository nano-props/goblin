import { describe, expect, test, vi } from 'vitest'
import {
  REALTIME_HEARTBEAT_DEADLINE_MS as HEARTBEAT_DEADLINE_MS,
  REALTIME_HEARTBEAT_INTERVAL_MS as HEARTBEAT_INTERVAL_MS,
  AppRealtimeSocketLimitError,
  MAX_APP_REALTIME_SOCKETS,
} from '#/server/realtime/realtime-broker.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'
import {
  TEST_NOW,
  USER_1,
  appRealtimeSocket,
  buildRuntime,
  createTerminalSession,
} from '#/server/test-utils/terminal-runtime.ts'

describe('server terminal runtime sockets and diagnostics', () => {
  test('exposes a closing-state supervisor after shutdown', async () => {
    const { host, shutdown } = buildRuntime()
    expect(host.getDiagnostics().terminal.shuttingDown).toBe(false)
    shutdown()
    expect(host.getDiagnostics().terminal.shuttingDown).toBe(true)
  })

  test('shutdown does not leave detached-user timers after closing registered sockets', () => {
    useFakeTimers()
    try {
      const { host, shutdown } = buildRuntime()
      const socket = appRealtimeSocket()
      host.registerSocket('client_shutdown', USER_1, socket)

      shutdown()

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('getDiagnostics exposes the live logical session count', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_1', USER_1, socket)
    try {
      // Empty runtime: no sessions.
      let stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(0)

      // Prepared sessions are already server-owned logical sessions even
      // before their fitted client view establishes a PTY binding.
      const sessionA = await createTerminalSession(host, 'client_1')
      const sessionB = await createTerminalSession(host, 'client_1')
      stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(2)

      expect([sessionA, sessionB]).toHaveLength(2)
    } finally {
      host.unregisterSocket('client_1', USER_1, socket)
      shutdown()
    }
  })

  test('runtime routes a heartbeat envelope to the registered socket', () => {
    // The broker owns a distinct clock for every registered buffered socket.
    // This covers the raw-to-buffered transport lookup in
    // `handleRealtimeMessage`; recording the raw socket would silently miss
    // the registered transport and evict a healthy controller.
    //
    // The assertion is end-to-end: after a real heartbeat has been
    // routed through the runtime, advancing the fake clock past
    // the original deadline must NOT flip broker presence offline.
    // The raw socket would remain registered either way; this assertion
    // is about `isClientOnline`.
    useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    const { host, shutdown, isClientOnline } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)
    try {
      // First heartbeat at t=0.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      // Advance just shy of the original deadline.
      vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS - 1_000)
      // Heartbeat again. If it is not attributed to this exact registered
      // transport, the next scan will flip presence offline.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      // Advance past the original 90 s deadline. A correctly routed
      // heartbeat (a real client sending every 30 s) means the
      // broker clock is fresh, so presence must remain online.
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      expect(isClientOnline('client_a')).toBe(true)
      expect(socket.close).not.toHaveBeenCalled()
    } finally {
      shutdown()
    }
  })

  test('does not route messages from a socket rejected by admission', () => {
    const { host, shutdown } = buildRuntime()
    const admittedSockets = Array.from({ length: MAX_APP_REALTIME_SOCKETS }, (_, index) => ({
      clientId: `client_admitted_${index}`,
      socket: appRealtimeSocket(),
    }))
    for (const admitted of admittedSockets) {
      host.registerSocket(admitted.clientId, USER_1, admitted.socket)
    }
    const overflowSocket = appRealtimeSocket()

    try {
      expect(() => host.registerSocket('client_overflow', USER_1, overflowSocket)).toThrow(AppRealtimeSocketLimitError)

      host.handleRealtimeMessage(
        'client_overflow',
        USER_1,
        overflowSocket,
        JSON.stringify({ type: 'ping', requestId: 'health_overflow' }),
      )

      expect(overflowSocket.send).not.toHaveBeenCalled()
      expect(overflowSocket.close).not.toHaveBeenCalled()
    } finally {
      shutdown()
    }
  })

  test('runtime answers terminal socket health pings with pong', () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)

    host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'ping', requestId: 'health_1' }))

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', requestId: 'health_1' }))
    shutdown()
  })

  test('runtime health ping refreshes broker presence before the next heartbeat scan', () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = appRealtimeSocket()
      host.registerSocket('client_a', USER_1, socket)

      vi.advanceTimersByTime(1)
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      vi.advanceTimersByTime(99_999)
      expect(handle.isClientOnline('client_a')).toBe(true)

      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'ping', requestId: 'health_1' }))
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

      expect(handle.isClientOnline('client_a')).toBe(true)
      expect(socket.close).not.toHaveBeenCalledWith(1001, 'terminal heartbeat timeout')
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', requestId: 'health_1' }))
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })
})
