import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'
import type { GoblinNativeBridge } from '#/shared/goblin-native-bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

type ExposedGoblinNativeBridge = Omit<
  GoblinNativeBridge,
  'host' | 'terminal' | 'onAppQuitting' | 'onIntent' | 'getAccessTokenProjection' | 'rotateAccessToken'
> & {
  host: NonNullable<GoblinNativeBridge['host']>
  terminal: Required<GoblinNativeBridge['terminal']>
  onAppQuitting: GoblinNativeBridge['onAppQuitting']
  onIntent: NonNullable<GoblinNativeBridge['onIntent']>
  getAccessTokenProjection: NonNullable<GoblinNativeBridge['getAccessTokenProjection']>
  rotateAccessToken: NonNullable<GoblinNativeBridge['rotateAccessToken']>
}

/**
 * Pull every single-quoted string literal out of `preload.cjs` that
 * matches the shape of an IPC channel name. The preload hardcodes
 * its channels as string literals (the sandboxed `require` cannot
 * resolve a Node-side enum at preload time, see the file header),
 * so scanning for `'foo:bar'` literals is a reliable proxy for
 * "channels this preload actually invokes". The manifest lockdown
 * test compares this set against `BROWSER_MISSING_CHANNELS` in
 * both directions.
 *
 * The literal regex requires a `:` so it doesn't pick up unrelated
 * identifiers like `'goblinNative'` (the contextBridge key) or
 * `'CodedError'` (a class name) — those don't have a namespace prefix
 * because IPC channels always do (`goblin:client-effect-intent`, `shell:open-external-url`, …).
 */
function extractIpcChannelLiterals(source: string): string[] {
  const literal = /'([a-z][a-z0-9-]*:[a-z0-9-]+)'/gi
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = literal.exec(source)) !== null) {
    seen.add(match[1])
  }
  return [...seen]
}
import {
  APP_QUIT_DRAINED_CHANNEL,
  CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL,
  CLIENT_EFFECT_INTENT_CHANNEL,
  CLIENT_EFFECT_INTENT_READY_CHANNEL,
  HOST_IPC_ABORT_CHANNEL,
  HOST_IPC_CALL_CHANNEL,
  HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
  HOST_OPEN_DIRECTORY_DIALOG_CHANNEL,
  HOST_OPEN_EXTERNAL_URL_CHANNEL,
  HOST_OPEN_SETTINGS_WINDOW_CHANNEL,
  TERMINAL_NOTIFY_BELL_CHANNEL,
  TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
  TERMINAL_SET_BADGE_CHANNEL,
  ROTATE_ACCESS_TOKEN_CHANNEL,
  GET_ACCESS_TOKEN_PROJECTION_CHANNEL,
} from '#/shared/ipc-channels.ts'

function loadPreload(
  options: {
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>
    argv?: string[]
  } = {},
) {
  const exposed = {} as { goblinNative: ExposedGoblinNativeBridge; [key: string]: unknown }
  const invocations: Array<{ channel: string; args: unknown[] }> = []
  const sends: Array<{ channel: string; args: unknown[] }> = []
  const ipcRenderer = {
    invoke: vi.fn((channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args })
      return options.invoke?.(channel, ...args) ?? Promise.resolve({ ok: true, data: 'ok' })
    }),
    sendSync: vi.fn((channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args })
      // The preload used to call `sendSync` to seed the bootstrap
      // before the client's modules started (access token,
      // server URL, home dir, platform). Those channels are gone:
      // auth is via the http-only cookie planted by main, server
      // URL is `window.location.origin`, and host info lives on
      // the public `/api/host` endpoint. `sendSync` is still
      // exposed by Electron so we keep the mock in case a future
      // test needs to assert that no preload call uses it.
      return { ok: true }
    }),
    send: vi.fn((channel: string, ...args: unknown[]) => {
      sends.push({ channel, args })
    }),
    on: vi.fn(),
    off: vi.fn(),
  }
  const code = readFileSync(path.join(import.meta.dirname, '../preload/preload.cjs'), 'utf8')
  const sandbox = {
    console,
    Buffer,
    process: { argv: options.argv ?? [] },
    window: { __GOBLIN_BOOTSTRAP__: undefined },
    require: (name: string) => {
      if (name !== 'electron') throw new Error(`unexpected require: ${name}`)
      return {
        contextBridge: {
          exposeInMainWorld: (key: string, api: unknown) => {
            exposed[key] = api
          },
        },
        ipcRenderer,
        webUtils: { getPathForFile: vi.fn() },
      }
    },
  }
  vm.runInNewContext(code, sandbox, { filename: 'preload.cjs' })
  // The preload is now strictly an IPC bridge — no load-time
  // bootstrap seeding, no `sendSync` calls at module init. The
  // invocation log starts clean.
  invocations.length = 0
  return { goblinNative: exposed.goblinNative, invocations, sends, ipcRenderer }
}

describe('preload goblinNative bridge', () => {
  test('exposes only the IPC surface, no bootstrap fields', () => {
    // The bootstrap is now empty on first paint in every runtime.
    // The preload no longer seeds `window.__GOBLIN_BOOTSTRAP__`
    // with anything — auth is via the http-only cookie planted by
    // main, the server URL is `window.location.origin`, and host
    // info (homeDir, platform) is fetched from the public
    // `/api/host` endpoint during `useAppBootstrap.hydrate()`. The
    // `goblinNative` object therefore stays a strict IPC bridge
    // for browser-missing capabilities (file paths, shell
    // dialogs, terminal notifications, etc.) and does not leak
    // any bootstrap-shaped field onto itself.
    const { goblinNative } = loadPreload()
    expect(goblinNative).not.toHaveProperty('runtime')
    expect(goblinNative).not.toHaveProperty('homeDir')
    expect(goblinNative).not.toHaveProperty('platform')
    expect(goblinNative).not.toHaveProperty('initialServer')
    expect(goblinNative).toHaveProperty('invokeIpc')
    expect(goblinNative).toHaveProperty('abortIpc')
    expect(goblinNative).toHaveProperty('pathForFile')
    expect(goblinNative).toHaveProperty('host')
    expect(goblinNative).toHaveProperty('terminal')
    expect(goblinNative).toHaveProperty('onAppQuitting')
    expect(goblinNative).toHaveProperty('onIntent')
  })

  test('forwards IPC request ids to the native host', async () => {
    const { goblinNative, invocations } = loadPreload()

    await goblinNative.invokeIpc({ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'ipc_test_1' })

    expect(invocations[0]).toEqual({
      channel: HOST_IPC_CALL_CHANNEL,
      args: [{ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'ipc_test_1' }],
    })
  })

  test('uses a transport control channel for IPC aborts', async () => {
    const { goblinNative, invocations } = loadPreload()

    await goblinNative.abortIpc('ipc_test_1')

    expect(invocations[0]).toEqual({
      channel: HOST_IPC_ABORT_CHANNEL,
      args: [{ requestId: 'ipc_test_1' }],
    })
  })

  test('forwards host shell calls to their IPC channels', async () => {
    const { goblinNative, invocations } = loadPreload()

    await goblinNative.host.openSettingsWindow({ page: 'about' })
    await goblinNative.host.openExternalUrl({ url: 'https://example.com', allowHttp: false })
    await goblinNative.host.openDirectoryDialog({ title: 'Open Git Repository' })
    await goblinNative.host.consumeExternalOpenPaths()

    expect(invocations.map((entry) => entry.channel)).toEqual([
      HOST_OPEN_SETTINGS_WINDOW_CHANNEL,
      HOST_OPEN_EXTERNAL_URL_CHANNEL,
      HOST_OPEN_DIRECTORY_DIALOG_CHANNEL,
      HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
    ])
  })

  test('forwards native terminal notification calls to their IPC channels', async () => {
    const { goblinNative, invocations, sends, ipcRenderer } = loadPreload()

    await goblinNative.terminal.notifyBell({
      terminalSessionId: 'term-testtesttesttesttest0',
      title: 'Goblin',
      body: 'Bell',
      session: {
        target: {
          kind: 'workspace-root',
          workspaceId: workspaceIdForTest('goblin+file:///workspace'),
          workspaceRuntimeId: 'workspace-runtime-test',
        },
        presentation: { kind: 'workspace-root' },
      },
    })
    await goblinNative.terminal.sendTestNotification({ title: 'Goblin', body: 'Test' })
    goblinNative.terminal.setBadge(2)

    expect(invocations.map((entry) => entry.channel)).toEqual([
      TERMINAL_NOTIFY_BELL_CHANNEL,
      TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
    ])
    expect(invocations[1]?.args).toEqual([{ title: 'Goblin', body: 'Test' }])
    expect(sends).toContainEqual({ channel: TERMINAL_SET_BADGE_CHANNEL, args: [2] })
  })

  test('logs failed IPC calls with the request path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { goblinNative } = loadPreload({
      invoke: () => Promise.resolve({ ok: false, error: { message: 'boom' } }),
    })

    await expect(
      goblinNative.invokeIpc({ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'ipc_test_1' }),
    ).rejects.toThrow('boom')

    expect(warn.mock.calls[0]?.[0]).toBe('[ipc] repo.status failed')
    expect((warn.mock.calls[0]?.[1] as Error | undefined)?.message).toBe('boom')
    warn.mockRestore()
  })

  test('uses one renderer consumer for the preload-lifetime effect-intent listener', () => {
    const { goblinNative, ipcRenderer } = loadPreload()
    const consumer = vi.fn()

    expect(ipcRenderer.on).toHaveBeenCalledWith(CLIENT_EFFECT_INTENT_CHANNEL, expect.any(Function))

    const intentListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === CLIENT_EFFECT_INTENT_CHANNEL,
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    const off = goblinNative.onIntent(consumer)
    expect(() => goblinNative.onIntent(vi.fn())).toThrow('Client effect intent consumer is already registered')
    intentListener?.(null, { type: 'external-open-enqueued' })
    expect(consumer).toHaveBeenCalledWith({ type: 'external-open-enqueued' })

    off()
    expect(ipcRenderer.off).not.toHaveBeenCalledWith(CLIENT_EFFECT_INTENT_CHANNEL, intentListener)
  })

  test('delivers app quitting independently from the UI intent consumer', () => {
    const { goblinNative, ipcRenderer } = loadPreload()
    const intentListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === CLIENT_EFFECT_INTENT_CHANNEL,
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    const uiConsumer = vi.fn()
    const quittingConsumer = vi.fn()
    goblinNative.onIntent(uiConsumer)

    intentListener?.(null, { type: 'app-quitting' })
    expect(uiConsumer).not.toHaveBeenCalled()
    goblinNative.onAppQuitting(quittingConsumer)

    expect(quittingConsumer).toHaveBeenCalledOnce()
  })

  test('echoes only a valid challenged document generation', () => {
    const { sends, ipcRenderer } = loadPreload()

    expect(ipcRenderer.on).toHaveBeenCalledWith(CLIENT_EFFECT_INTENT_CHANNEL, expect.any(Function))
    expect(ipcRenderer.on).toHaveBeenCalledWith(CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL, expect.any(Function))
    expect(sends).toEqual([])

    const challengeListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL,
    )?.[1] as ((event: unknown, generation: unknown) => void) | undefined
    challengeListener?.(null, 0)
    challengeListener?.(null, '7')
    expect(sends).toEqual([])
    challengeListener?.(null, 7)

    expect(sends).toContainEqual({ channel: CLIENT_EFFECT_INTENT_READY_CHANNEL, args: [7] })
  })

  test('drains effect intents received before the renderer subscribes', () => {
    const { goblinNative, ipcRenderer } = loadPreload()
    const intentListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === CLIENT_EFFECT_INTENT_CHANNEL,
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    const intent = { type: 'terminal-bell-click', terminalSessionId: 'term-111111111111111111111' }

    intentListener?.(null, intent)
    const subscriber = vi.fn()
    goblinNative.onIntent(subscriber)

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber).toHaveBeenCalledWith(intent)
  })

  test('coalesces queued external-open wakeups while preserving discrete user intents', () => {
    const { goblinNative, ipcRenderer } = loadPreload()
    const intentListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === CLIENT_EFFECT_INTENT_CHANNEL,
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    const bell = { type: 'terminal-bell-click', terminalSessionId: 'term-111111111111111111111' }

    intentListener?.(null, { type: 'external-open-enqueued' })
    intentListener?.(null, bell)
    intentListener?.(null, { type: 'external-open-enqueued' })
    intentListener?.(null, bell)
    const consumer = vi.fn()
    goblinNative.onIntent(consumer)

    expect(consumer.mock.calls.map(([intent]) => intent)).toEqual([{ type: 'external-open-enqueued' }, bell, bell])
  })

  test('queues new effect intents after the renderer consumer unsubscribes', () => {
    const { goblinNative, ipcRenderer } = loadPreload()
    const intentListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === CLIENT_EFFECT_INTENT_CHANNEL,
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    const firstConsumer = vi.fn()
    const off = goblinNative.onIntent(firstConsumer)
    off()

    const queuedIntent = { type: 'external-open-enqueued' }
    intentListener?.(null, queuedIntent)
    expect(firstConsumer).not.toHaveBeenCalled()

    const nextConsumer = vi.fn()
    goblinNative.onIntent(nextConsumer)
    expect(nextConsumer).toHaveBeenCalledOnce()
    expect(nextConsumer).toHaveBeenCalledWith(queuedIntent)
  })

  test('forwards access-token projection and rotation to their native IPC channels', async () => {
    // Token rotation exists only in the embedded Electron build because
    // main owns the canonical next-start token file.
    const { goblinNative, invocations } = loadPreload()
    await goblinNative.getAccessTokenProjection()
    await goblinNative.rotateAccessToken()

    expect(invocations.map((entry) => entry.channel)).toEqual([
      GET_ACCESS_TOKEN_PROJECTION_CHANNEL,
      ROTATE_ACCESS_TOKEN_CHANNEL,
    ])
  })

  test('locks the goblinNative IPC surface to browser-missing capabilities', () => {
    // The client's "Server First" architecture means the server
    // is the single source of truth: any IPC channel that the
    // server *could* expose over `/api/*` belongs on the HTTP
    // surface, not here. The remaining IPC channels must each be a
    // capability the browser can't provide.
    //
    // If a future refactor adds a new IPC channel here, this test
    // forces a corresponding entry in `BROWSER_MISSING_CHANNELS`
    // with a justification — i.e. a future contributor has to
    // explain why the server can't host the capability before the
    // channel can land. That justification is the contract.
    const BROWSER_MISSING_CHANNELS: Record<string, string> = {
      [HOST_IPC_CALL_CHANNEL]:
        'native-only RPC dispatch — currently used for global-shortcut registration, native menu rebuilds, and workspace-layout menu gating',
      [HOST_IPC_ABORT_CHANNEL]: 'paired with HOST_IPC_CALL_CHANNEL for cancellation',
      [CLIENT_EFFECT_INTENT_CHANNEL]: 'client effect intent dispatch (paired with the IPC dispatch channel)',
      [CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL]:
        'main → renderer exact-document readiness challenge before native intent delivery',
      [CLIENT_EFFECT_INTENT_READY_CHANNEL]:
        'renderer document readiness handshake — main must not dispatch native actions before preload is listening',
      [APP_QUIT_DRAINED_CHANNEL]:
        'renderer → main quit drain acknowledgement — main owns native app/server shutdown ordering',
      [HOST_OPEN_SETTINGS_WINDOW_CHANNEL]:
        'native primary-window activation — bring the Electron surface forward before routing it to the requested settings page',
      [HOST_OPEN_EXTERNAL_URL_CHANNEL]:
        'Electron shell.openExternal — protocol-handler restrictions the browser API cannot enforce',
      [HOST_OPEN_DIRECTORY_DIALOG_CHANNEL]: 'native OS directory picker dialog (no browser equivalent)',
      [HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL]:
        'OS file-association handoff (Finder/Explorer "open with Goblin") — Electron-only queue',
      [TERMINAL_NOTIFY_BELL_CHANNEL]:
        'Electron Notification API — desktop-attached notifications with per-app identity',
      [TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL]:
        'paired with TERMINAL_NOTIFY_BELL_CHANNEL for the settings-page "test" button',
      [TERMINAL_SET_BADGE_CHANNEL]: 'app.dock.setBadge / taskbar badge count — Electron BrowserWindow only',
      [GET_ACCESS_TOKEN_PROJECTION_CHANNEL]:
        'running-vs-next-start credential projection — only Electron main owns both authority sources',
      [ROTATE_ACCESS_TOKEN_CHANNEL]: 'next-start credential replacement — only Electron main owns its data path',
    }

    // Every channel the preload touches must appear in the manifest.
    // Drift in either direction (a channel added to preload but not
    // the manifest, or a manifest entry with no corresponding IPC
    // call) fails this test — surfacing both classes of regression.
    //
    // The check is deliberately *bi-directional*: it parses every
    // single-quoted literal that looks like an IPC channel out of
    // `preload.cjs` and asserts that set equals the manifest. The
    // earlier version of this assertion compared the manifest's
    // keys to a hardcoded list and then asserted each manifest
    // key was referenced in preload.cjs — that was tautological
    // (the hardcoded list duplicated the manifest) and only
    // one-way (a brand-new channel could land in preload.cjs and
    // the test would still pass).
    const preloadSource = readFileSync(path.join(import.meta.dirname, '../preload/preload.cjs'), 'utf8')
    const channelsUsedByPreload = extractIpcChannelLiterals(preloadSource)

    // Forward: every manifest entry must be referenced by preload.
    for (const channel of Object.keys(BROWSER_MISSING_CHANNELS)) {
      expect(channelsUsedByPreload, `manifest channel ${channel} missing from preload.cjs`).toContain(channel)
    }

    // Reverse: every channel preload actually uses must be in the
    // manifest. This is the half the old test was missing — a new
    // `safeInvoke('brand-new-channel', …)` would have slipped
    // through silently. Now it fails until the contributor adds a
    // manifest entry with a real justification.
    const manifestKeys = Object.keys(BROWSER_MISSING_CHANNELS)
    const orphanChannels = channelsUsedByPreload.filter((channel) => !manifestKeys.includes(channel))
    expect(
      orphanChannels,
      `preload.cjs uses channels not in BROWSER_MISSING_CHANNELS: ${orphanChannels.join(', ')}`,
    ).toEqual([])

    // Spot-check that justifications aren't empty — a manifest
    // entry with no rationale is a TODO disguised as a contract.
    for (const [channel, rationale] of Object.entries(BROWSER_MISSING_CHANNELS)) {
      expect(rationale.length, `${channel} must have a justification`).toBeGreaterThan(20)
    }
  })

  test('the channel-extraction helper detects unwired channels (self-check)', () => {
    // Sanity-check on `extractIpcChannelLiterals`: pretend preload
    // just grew a new IPC call. The helper should surface it as
    // "unwired" so the lockdown test above fails fast. If this
    // assertion ever stops failing on the synthetic input, the
    // helper has rotted and the lockdown test is no longer
    // bi-directional.
    const synthetic = `
      safeInvoke('goblin:ipc', payload)
      safeInvoke('shell:brand-new-channel', payload)
      const api = 'goblinNative'
      const errorName = 'CodedError'
    `
    const detected = extractIpcChannelLiterals(synthetic)
    expect(detected).toContain('goblin:ipc')
    expect(detected).toContain('shell:brand-new-channel')
    // TypeScript-style identifiers without `:` must NOT match — the
    // lockdown test relies on this so contextBridge keys and class
    // names don't pollute the channel set.
    expect(detected).not.toContain('goblinNative')
    expect(detected).not.toContain('CodedError')
  })
})
