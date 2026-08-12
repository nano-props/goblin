import { describe, expect, test, vi } from 'vitest'
import { acquireWorkspaceRuntime, releaseWorkspaceRuntime } from '#/server/modules/workspace-runtimes.ts'
import { REALTIME_LIVENESS_PROBE_INTERVAL_MS } from '#/server/realtime/realtime-broker.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import {
  CLIENT_STATE_GRACE_MS,
  LIVENESS_SILENCE_MS,
  REPO_ROOT,
  TEST_NOW,
  USER_1,
  WORKSPACE_RUNTIME_ID,
  appRealtimeSocket,
  buildRuntime,
  createTerminalSession,
} from '#/server/test-utils/terminal-runtime.ts'

const LONG_IDLE_MS = 24 * 60 * 60 * 1_000

describe('server terminal runtime expiry', () => {
  test('runtime: controller projection recovers when a long-idle client reconnects', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = await buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = appRealtimeSocket()
      host.registerSocket('client_idle', USER_1, socket)
      const terminalRuntimeSessionId = await createTerminalSession(host, 'client_idle')

      expect(
        await host.listSessions('client_idle', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: { clientId: 'client_idle', status: 'connected' },
        }),
      ])

      vi.advanceTimersByTime(LIVENESS_SILENCE_MS)
      expect(handle.isClientOnline('client_idle')).toBe(false)
      expect(
        await host.listSessions('client_idle', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: null,
        }),
      ])

      const reconnectedSocket = appRealtimeSocket()
      host.registerSocket('client_idle', USER_1, reconnectedSocket)
      expect(handle.isClientOnline('client_idle')).toBe(true)
      expect(
        await host.listSessions('client_idle', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: { clientId: 'client_idle', status: 'connected' },
        }),
      ])
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: a long-idle disconnected terminal remains recoverable', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = await buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = appRealtimeSocket()
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_half_open')
      host.registerSocket('client_half_open', USER_1, socket)
      await createTerminalSession(host, 'client_half_open')

      vi.advanceTimersByTime(LIVENESS_SILENCE_MS)
      expect(host.getDiagnostics().terminal.registeredSockets).toBe(0)
      expect(handle.isClientOnline('client_half_open')).toBe(false)

      await advanceTimersAndFlush(LONG_IDLE_MS)

      expect(host.getDiagnostics().terminal.liveSessionCount).toBe(1)
      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_reconnected')).toBe(WORKSPACE_RUNTIME_ID)
      await expect(
        host.listSessions('client_reconnected', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: detached client expiry releases its repo memberships without closing sibling epochs', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = await buildRuntime()
      shutdownFn = handle.shutdown
      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_expiring')).toBe(WORKSPACE_RUNTIME_ID)
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_survivor')
      const survivorSocket = appRealtimeSocket()
      handle.host.registerSocket('client_survivor', USER_1, survivorSocket)
      const socket = appRealtimeSocket()
      handle.host.registerSocket('client_expiring', USER_1, socket)
      handle.host.unregisterSocket('client_expiring', USER_1, socket)

      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID, 'client_expiring')).toEqual({
        released: false,
        runtimeClosed: false,
      })
      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID, 'client_survivor')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: client expiry removes stale terminal authority while a replacement client keeps the session', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = await buildRuntime()
      shutdownFn = handle.shutdown
      const oldClientId = 'client_before_reload'
      const replacementClientId = 'client_after_reload'
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, oldClientId)
      const oldSocket = appRealtimeSocket()
      handle.host.registerSocket(oldClientId, USER_1, oldSocket)
      const terminalRuntimeSessionId = await createTerminalSession(handle.host, oldClientId)

      handle.host.unregisterSocket(oldClientId, USER_1, oldSocket)
      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, replacementClientId)).toBe(WORKSPACE_RUNTIME_ID)
      const replacementSocket = appRealtimeSocket()
      handle.host.registerSocket(replacementClientId, USER_1, replacementSocket)
      await expect(
        handle.host.listSessions(replacementClientId, USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).resolves.toEqual([expect.objectContaining({ terminalRuntimeSessionId, controller: null })])

      await expect(
        handle.host.attach(replacementClientId, USER_1, {
          terminalRuntimeSessionId,
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        }),
      ).resolves.toMatchObject({
        ok: true,
        controller: { clientId: replacementClientId, status: 'connected' },
      })
      expect(handle.host.getDiagnostics().terminal.liveSessionCount).toBe(1)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: a repo membership that never establishes realtime presence expires', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = await buildRuntime()
      shutdownFn = handle.shutdown
      const runtimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_never_online')

      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, runtimeId, 'client_never_online')).toEqual({
        released: false,
        runtimeClosed: false,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: first realtime presence cancels the orphan membership expiry', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = await buildRuntime()
      shutdownFn = handle.shutdown
      const runtimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_claimed_before_expiry')
      const socket = appRealtimeSocket()
      handle.host.registerSocket('client_claimed_before_expiry', USER_1, socket)

      for (let elapsed = 0; elapsed < CLIENT_STATE_GRACE_MS * 2; elapsed += REALTIME_LIVENESS_PROBE_INTERVAL_MS) {
        handle.host.handleRealtimeMessage(
          'client_claimed_before_expiry',
          USER_1,
          socket,
          JSON.stringify({ type: 'ping', requestId: `health_claimed_${elapsed}` }),
        )
        await advanceTimersAndFlush(REALTIME_LIVENESS_PROBE_INTERVAL_MS)
      }

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, runtimeId, 'client_claimed_before_expiry')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: an already-online client acquires membership without an orphan timer', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = await buildRuntime()
      shutdownFn = handle.shutdown
      const socket = appRealtimeSocket()
      handle.host.registerSocket('client_online_before_acquire', USER_1, socket)
      const runtimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_online_before_acquire')

      for (let elapsed = 0; elapsed < CLIENT_STATE_GRACE_MS * 2; elapsed += REALTIME_LIVENESS_PROBE_INTERVAL_MS) {
        handle.host.handleRealtimeMessage(
          'client_online_before_acquire',
          USER_1,
          socket,
          JSON.stringify({ type: 'ping', requestId: `health_online_${elapsed}` }),
        )
        await advanceTimersAndFlush(REALTIME_LIVENESS_PROBE_INTERVAL_MS)
      }

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, runtimeId, 'client_online_before_acquire')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: a membership renewed after disconnect survives the stale expiry timer', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = await buildRuntime()
      shutdownFn = handle.shutdown
      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_renewed')).toBe(WORKSPACE_RUNTIME_ID)
      const socket = appRealtimeSocket()
      handle.host.registerSocket('client_renewed', USER_1, socket)
      handle.host.unregisterSocket('client_renewed', USER_1, socket)
      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_renewed')).toBe(WORKSPACE_RUNTIME_ID)
      const reconnectedSocket = appRealtimeSocket()
      handle.host.registerSocket('client_renewed', USER_1, reconnectedSocket)

      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID, 'client_renewed')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })
})
