import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as v from 'valibot'
import { createApp } from '#/server/app-factory.ts'
import { createHttpTransport } from '#/server/g-command/transport.ts'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import type { ServerTerminalCommandHost } from '#/server/terminal/terminal-command-host.ts'
import { GOBLIN_SERVER_COMMAND_RESULT_SCHEMA } from '#/shared/g-command.ts'
import { CodedError } from '#/shared/coded-error.ts'
import { disconnectAllClientIntentSockets, registerClientIntentSocket } from '#/server/realtime/client-intent-broker.ts'

const TERMINAL_SESSION_ID = 'term-111111111111111111111'

function terminalCommandHost(): ServerTerminalCommandHost {
  return {
    execute: vi.fn(async () => ({ ok: true as const, value: { output: 'terminal list' } })),
  }
}

function appRealtimeHost(): ServerAppRealtimeHost {
  return {
    isValidClientId: (value: unknown): value is string => typeof value === 'string',
    getDiagnostics: vi.fn(() => ({}) as never),
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    handleRealtimeMessage: vi.fn(),
    shutdown: vi.fn(),
  }
}

const workspacePaneTabsHost = {
  restoreTabs: vi.fn(async () => ({
    kind: 'restored' as const,
    snapshot: { revision: 0, entries: [] },
    repaired: false,
  })),
  listWorkspaceTabs: vi.fn(),
  updateTabs: vi.fn(),
} satisfies ServerWorkspacePaneTabsHost

function createTestApp(host?: ServerTerminalCommandHost) {
  return createApp({
    version: '0.1.0',
    startedAt: 0,
    accessToken: 'secret',
    appRealtimeHost: appRealtimeHost(),
    workspacePaneTabsHost,
    worktreeRemovalApplication: { removeWorktree: vi.fn(async () => ({ ok: false as const, message: 'unused' })) },
    workspaceCapabilityTransitionHost: {
      commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
    },
    terminalCommandHost: host,
  })
}

describe('terminal command routes', () => {
  beforeEach(() => {
    disconnectAllClientIntentSockets()
  })

  test('rejects terminal inspection without the access token', async () => {
    const response = await createTestApp(terminalCommandHost()).request('/api/terminal-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'term', payload: { terminalSessionId: TERMINAL_SESSION_ID, args: ['list'] } }),
    })

    expect(response.status).toBe(401)
  })

  test('serves the terminal list through the real g-command transport', async () => {
    const host = terminalCommandHost()
    const app = createTestApp(host)
    const transport = createHttpTransport(
      { GOBLIN_SERVER_URL: 'http://127.0.0.1:32100', GOBLIN_SERVER_ACCESS_TOKEN: 'secret' },
      async (input, init) => await app.fetch(new Request(input, init)),
    )

    const result = await transport.postJson(
      '/api/terminal-command',
      { command: 'term', payload: { terminalSessionId: TERMINAL_SESSION_ID, args: ['list'] } },
      (value) => v.parse(GOBLIN_SERVER_COMMAND_RESULT_SCHEMA, value),
    )

    expect(result.output).toBe('terminal list')
    expect(host.execute).toHaveBeenCalledWith(
      expect.stringMatching(/^user_/),
      TERMINAL_SESSION_ID,
      ['list'],
      expect.any(AbortSignal),
    )
  })

  test.each([
    ['delta', 'changes'],
    ['info', 'status'],
    ['log', 'history'],
  ] as const)('dispatches %s through the consolidated endpoint', async (command, tab) => {
    const subscriber = { send: vi.fn(), close: vi.fn() }
    registerClientIntentSocket(subscriber)
    const app = createTestApp(terminalCommandHost())
    const response = await app.request('/api/terminal-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goblin-access-token': 'secret' },
      body: JSON.stringify({ command, payload: { args: [] } }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ output: '' })
    expect(subscriber.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'client-effect-intent',
        intent: { type: 'show-workspace-pane-tab-requested', tab },
      }),
    )
  })

  test('validates view arguments at the consolidated server boundary', async () => {
    const response = await createTestApp(terminalCommandHost()).request('/api/terminal-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goblin-access-token': 'secret' },
      body: JSON.stringify({ command: 'info', payload: { args: ['extra'] } }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, message: "'info' does not take arguments" })
  })

  test('rejects invalid terminal arguments as a bad request', async () => {
    const host: ServerTerminalCommandHost = {
      async execute() {
        throw new CodedError({
          code: 'BAD_REQUEST',
          message: "expected 'g term', 'g term list', or 'g term prune'",
        })
      },
    }
    const response = await createTestApp(host).request('/api/terminal-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goblin-access-token': 'secret' },
      body: JSON.stringify({
        command: 'term',
        payload: { terminalSessionId: TERMINAL_SESSION_ID, args: ['unknown'] },
      }),
    })

    expect(response.status).toBe(400)
  })

  test('reports an unavailable terminal host', async () => {
    const response = await createTestApp().request('/api/terminal-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goblin-access-token': 'secret' },
      body: JSON.stringify({
        command: 'term',
        payload: { terminalSessionId: TERMINAL_SESSION_ID, args: ['list'] },
      }),
    })

    expect(response.status).toBe(503)
  })

  test('reports terminal application failures', async () => {
    const host: ServerTerminalCommandHost = {
      execute: vi.fn(async () => ({ ok: false as const, message: 'terminal no longer exists' })),
    }
    const response = await createTestApp(host).request('/api/terminal-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goblin-access-token': 'secret' },
      body: JSON.stringify({
        command: 'term',
        payload: { terminalSessionId: TERMINAL_SESSION_ID, args: ['list'] },
      }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ message: 'terminal no longer exists' })
  })
})
