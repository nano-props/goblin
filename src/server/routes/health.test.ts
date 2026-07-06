import { describe, expect, test, vi } from 'vitest'
import { createHealthRoutes } from '#/server/routes/health.ts'

const mocks = vi.hoisted(() => ({
  getBackgroundSyncDiagnostics: vi.fn(),
  appRealtimeHost: {
    getDiagnostics: vi.fn(),
  },
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  getBackgroundSyncDiagnostics: mocks.getBackgroundSyncDiagnostics,
}))

describe('health routes', () => {
  test('returns terminal diagnostics under the health namespace', async () => {
    mocks.appRealtimeHost.getDiagnostics.mockReturnValue({
      terminal: {
        mode: 'worker-backed',
        state: 'running',
        workerRunning: true,
        workerPid: 42,
        workerStartedAt: 1_000,
        workerUptimeMs: 300,
        pendingRequests: 1,
        registeredSockets: 2,
        restartAttempts: 0,
        restartScheduled: false,
        shuttingDown: false,
        lastSuccessfulResponseAt: 1_200,
        lastExitCode: null,
        lastExitSignal: null,
        lastWorkerFailure: null,
      },
    })

    const app = createHealthRoutes({ version: '0.1.0', startedAt: 123, appRealtimeHost: mocks.appRealtimeHost as any })
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
        workerRunning: true,
        workerPid: 42,
        registeredSockets: 2,
      },
    })
  })

  test('returns background sync diagnostics under the health namespace', async () => {
    mocks.getBackgroundSyncDiagnostics.mockReturnValue({
      running: true,
      intervalSec: 120,
      repoIds: ['/tmp/repo'],
      nextRepoIndex: 0,
      tickRunning: false,
      repos: [
        {
          repoId: '/tmp/repo',
          lastFetchAt: 1_000,
          failureCount: 2,
          backoffUntil: 5_000,
          nextEligibleAt: 5_000,
        },
      ],
    })

    const app = createHealthRoutes({ version: '0.1.0', startedAt: 123, appRealtimeHost: mocks.appRealtimeHost as any })
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
        repoIds: ['/tmp/repo'],
      },
    })
  })
})
