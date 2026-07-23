import { describe, expect, test, vi } from 'vitest'
import { createHealthRoutes } from '#/server/routes/health.ts'
import type { ServerAppRealtimeDiagnostics } from '#/server/realtime/app-realtime-host.ts'

const mocks = vi.hoisted(() => ({
  getBackgroundSyncHealth: vi.fn(),
  appRealtimeHost: {
    isValidClientId(value: unknown): value is string {
      return typeof value === 'string'
    },
    getDiagnostics: vi.fn(),
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    handleRealtimeMessage: vi.fn(),
    shutdown: vi.fn(),
  },
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  getBackgroundSyncHealth: mocks.getBackgroundSyncHealth,
}))

describe('health routes', () => {
  test('returns terminal diagnostics under the health namespace', async () => {
    mocks.appRealtimeHost.getDiagnostics.mockReturnValue({
      terminal: {
        mode: 'worker-backed',
        state: 'running',
        registeredSockets: 2,
        shuttingDown: false,
        pty: {
          mode: 'worker-backed',
          state: 'running',
          workerRunning: true,
          workerPid: 42,
          workerStartedAt: 1_000,
          workerUptimeMs: 300,
          pendingRequests: 1,
          restartAttempts: 0,
          restartScheduled: false,
          shuttingDown: false,
          lastSuccessfulResponseAt: 1_200,
          lastExitCode: null,
          lastExitSignal: null,
          lastFailure: null,
        },
        liveSessionCount: 1,
      },
    } satisfies ServerAppRealtimeDiagnostics)

    const app = createHealthRoutes({
      version: '0.1.0',
      startedAt: 123,
      appRealtimeHost: mocks.appRealtimeHost,
    })
    const response = await app.request('http://localhost/health/terminal')
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      service: 'goblin-server',
      version: '0.1.0',
      startedAt: 123,
      terminal: {
        mode: 'worker-backed',
        state: 'running',
        registeredSockets: 2,
        pty: {
          workerRunning: true,
          workerPid: 42,
        },
      },
    })
  })

  test('returns background sync diagnostics under the health namespace', async () => {
    mocks.getBackgroundSyncHealth.mockReturnValue({
      running: true,
      intervalSec: 120,
      registeredTargetCount: 1,
      tickRunning: false,
      queuePending: 0,
      queueSize: 0,
    })

    const app = createHealthRoutes({ version: '0.1.0', startedAt: 123, appRealtimeHost: mocks.appRealtimeHost })
    const response = await app.request('http://localhost/health/background-sync')
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      service: 'goblin-server',
      version: '0.1.0',
      startedAt: 123,
      backgroundSync: {
        running: true,
        intervalSec: 120,
        registeredTargetCount: 1,
      },
    })
    expect(json.backgroundSync).not.toHaveProperty('repoIds')
    expect(json.backgroundSync).not.toHaveProperty('repos')
  })
})
