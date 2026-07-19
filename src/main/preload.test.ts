import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'
import { CLIPBOARD_FALLBACK_FILE_NAME } from '#/shared/clipboard-paste.ts'

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
 * `'IpcError'` (a class name) — those don't have a namespace prefix
 * because IPC channels always do (`goblin:event`, `shell:open-external-url`, …).
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
  CLIENT_EFFECT_INTENT_CHANNEL,
  HOST_IPC_ABORT_CHANNEL,
  HOST_IPC_CALL_CHANNEL,
  HOST_IPC_EVENT_CHANNEL,
  HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
  HOST_OPEN_DIRECTORY_DIALOG_CHANNEL,
  HOST_OPEN_EXTERNAL_URL_CHANNEL,
  HOST_OPEN_SETTINGS_WINDOW_CHANNEL,
  TERMINAL_NOTIFY_BELL_CHANNEL,
  TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
  TERMINAL_SET_BADGE_CHANNEL,
  CLIPBOARD_SAVE_FILES_CHANNEL,
  ROTATE_ACCESS_TOKEN_CHANNEL,
} from '#/shared/ipc-channels.ts'

function loadPreload(
  options: {
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>
    argv?: string[]
  } = {},
) {
  const exposed: Record<string, any> = {}
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
    expect(goblinNative).toHaveProperty('saveClipboardFiles')
    expect(goblinNative).toHaveProperty('onEvent')
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
          workspaceId: 'goblin+file:///workspace',
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
    expect(ipcRenderer.on).not.toHaveBeenCalled()
    expect(ipcRenderer.off).not.toHaveBeenCalled()
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

  test('shares a single goblin:event ipc listener across subscribers', () => {
    const { goblinNative, ipcRenderer } = loadPreload()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    const off1 = goblinNative.onEvent(cb1)
    const off2 = goblinNative.onEvent(cb2)

    expect(ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.on).toHaveBeenCalledWith(HOST_IPC_EVENT_CHANNEL, expect.any(Function))

    const listener = ipcRenderer.on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    listener?.(null, { type: 'settings-write-error', message: 'failed' })
    expect(cb1).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    expect(cb2).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })

    off1()
    expect(ipcRenderer.off).not.toHaveBeenCalled()

    off2()
    expect(ipcRenderer.off).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.off).toHaveBeenCalledWith(HOST_IPC_EVENT_CHANNEL, listener)
  })

  test('continues delivering goblin:event when one subscriber throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { goblinNative, ipcRenderer } = loadPreload()
    const cb1 = vi.fn(() => {
      throw new Error('boom')
    })
    const cb2 = vi.fn()

    goblinNative.onEvent(cb1)
    goblinNative.onEvent(cb2)

    const listener = ipcRenderer.on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    listener?.(null, { type: 'settings-write-error', message: 'failed' })

    expect(cb1).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    expect(cb2).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    expect(warn).toHaveBeenCalledWith('[ipc] goblin:event subscriber failed', expect.any(Error))
    expect((warn.mock.calls[0]?.[1] as Error | undefined)?.message).toBe('boom')
    warn.mockRestore()
  })

  test('uses a dedicated effect-intent ipc listener across subscribers', () => {
    const { goblinNative, ipcRenderer } = loadPreload()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    const off1 = goblinNative.onIntent(cb1)
    const off2 = goblinNative.onIntent(cb2)

    expect(ipcRenderer.on).toHaveBeenCalledWith(CLIENT_EFFECT_INTENT_CHANNEL, expect.any(Function))

    const intentListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === CLIENT_EFFECT_INTENT_CHANNEL,
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    intentListener?.(null, { type: 'external-open-enqueued' })
    expect(cb1).toHaveBeenCalledWith({ type: 'external-open-enqueued' })
    expect(cb2).toHaveBeenCalledWith({ type: 'external-open-enqueued' })

    off1()
    expect(ipcRenderer.off).not.toHaveBeenCalledWith(CLIENT_EFFECT_INTENT_CHANNEL, intentListener)

    off2()
    expect(ipcRenderer.off).toHaveBeenCalledWith(CLIENT_EFFECT_INTENT_CHANNEL, intentListener)
  })

  test('forwards clipboard blob save and access-token rotation to their IPC channels', async () => {
    // These are the last two standalone channels on the preload
    // surface. They round out the "browser-missing only" invariant:
    // every `safeInvoke` / `ipcRenderer.send` call below is a
    // capability that the browser can't provide. The client
    // either falls through to its HTTP backend (clipboard) or
    // gets a typed "unavailable in this runtime" rejection
    // (rotateAccessToken — only the embedded Electron build can
    // restart its own server).
    const { goblinNative, invocations } = loadPreload()
    const blob = new Uint8Array([1, 2, 3])
    const unnamed = new Uint8Array([4])
    const files = [
      { name: 'a.png', bytes: blob.buffer },
      { name: CLIPBOARD_FALLBACK_FILE_NAME, bytes: unnamed.buffer },
    ]
    await goblinNative.saveClipboardFiles([
      { name: 'a.png', arrayBuffer: async () => blob.buffer } as unknown as File,
      { name: '', arrayBuffer: async () => unnamed.buffer } as unknown as File,
    ])
    await goblinNative.rotateAccessToken()

    expect(invocations.map((entry) => entry.channel)).toEqual([
      CLIPBOARD_SAVE_FILES_CHANNEL,
      ROTATE_ACCESS_TOKEN_CHANNEL,
    ])
    expect(invocations[0]?.args).toEqual([files])
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
      [HOST_IPC_EVENT_CHANNEL]: 'main → client event broadcast (Electron-only transport)',
      [CLIENT_EFFECT_INTENT_CHANNEL]: 'client effect intent dispatch (paired with the IPC dispatch channel)',
      [APP_QUIT_DRAINED_CHANNEL]:
        'renderer → main quit drain acknowledgement — main owns native app/server shutdown ordering',
      [HOST_OPEN_SETTINGS_WINDOW_CHANNEL]: 'BrowserWindow management — open the settings window as its own OS window',
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
      [CLIPBOARD_SAVE_FILES_CHANNEL]:
        'native host writes blob to <os.tmpdir>/goblin-clipboard-<pid>/ so the PTY can read it as a real file',
      [ROTATE_ACCESS_TOKEN_CHANNEL]: 'embedded-server restart — only Electron main owns the server lifecycle',
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
      const errorName = 'IpcError'
    `
    const detected = extractIpcChannelLiterals(synthetic)
    expect(detected).toContain('goblin:ipc')
    expect(detected).toContain('shell:brand-new-channel')
    // TypeScript-style identifiers without `:` must NOT match — the
    // lockdown test relies on this so contextBridge keys and class
    // names don't pollute the channel set.
    expect(detected).not.toContain('goblinNative')
    expect(detected).not.toContain('IpcError')
  })
})
