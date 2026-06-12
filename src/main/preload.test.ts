import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'
import type { RendererBootstrapPayload } from '#/shared/bootstrap.ts'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import {
  RENDERER_EFFECT_INTENT_CHANNEL,
  IPC_ABORT_CHANNEL,
  IPC_CHANNEL,
  IPC_EVENT_CHANNEL,
  SHELL_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
  SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL,
  SHELL_OPEN_EXTERNAL_URL_CHANNEL,
  SHELL_OPEN_IN_FINDER_CHANNEL,
  SHELL_OPEN_SETTINGS_WINDOW_CHANNEL,
  TERMINAL_NOTIFY_BELL_CHANNEL,
  TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
  TERMINAL_SET_BADGE_CHANNEL,
} from '#/shared/ipc-channels.ts'

function defaultArgv() {
  const bootstrap: RendererBootstrapPayload = {
    runtime: {
      kind: 'electron',
      bridgeVersion: RENDERER_BRIDGE_VERSION,
      capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
    },
    homeDir: '/home/test',
    i18n: { lang: 'en', pref: 'ja', dict: { hello: 'world' } },
    settings: {
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      globalShortcutRegistered: false,
      terminalApp: 'auto',
      editorApp: 'cursor',
      lanEnabled: false,
    },
    server: null,
  }
  return ['--goblin-bootstrap=' + Buffer.from(JSON.stringify(bootstrap)).toString('base64')]
}

function loadPreload(
  options: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>; argv?: string[] } = {},
) {
  const exposed: Record<string, any> = {}
  const invocations: Array<{ channel: string; args: unknown[] }> = []
  const sends: Array<{ channel: string; args: unknown[] }> = []
  const ipcRenderer = {
    invoke: vi.fn((channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args })
      return options.invoke?.(channel, ...args) ?? Promise.resolve({ ok: true, data: 'ok' })
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
    process: {
      argv: options.argv ?? defaultArgv(),
    },
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
  return { goblinNative: exposed.goblinNative, invocations, sends, ipcRenderer }
}

describe('preload goblinNative bridge', () => {
  test('exposes bootstrap snapshots parsed from the single preload payload', () => {
    const { goblinNative } = loadPreload()

    expect(goblinNative.runtime).toEqual({
      kind: 'electron',
      bridgeVersion: RENDERER_BRIDGE_VERSION,
      capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
    })
    expect(goblinNative.homeDir).toBe('/home/test')
    expect(goblinNative.initialI18n).toEqual({ lang: 'en', pref: 'ja', dict: { hello: 'world' } })
    expect(goblinNative.initialSettings).toMatchObject({
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      editorApp: 'cursor',
    })
  })

  test('falls back cleanly when the bootstrap payload is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { goblinNative } = loadPreload({ argv: ['--goblin-bootstrap=***not-base64***'] })

    expect(goblinNative.homeDir).toBe('')
    expect(goblinNative.initialI18n).toBeNull()
    expect(goblinNative.initialSettings).toBeNull()
    expect(warn.mock.calls[0]?.[0]).toBe('[preload] failed to parse bootstrap payload')
    expect((warn.mock.calls[0]?.[1] as { name?: string } | undefined)?.name).toBe('SyntaxError')
    warn.mockRestore()
  })

  test('forwards IPC request ids to the main process', async () => {
    const { goblinNative, invocations } = loadPreload()

    await goblinNative.invokeIpc({ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'ipc_test_1' })

    expect(invocations[0]).toEqual({
      channel: IPC_CHANNEL,
      args: [{ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'ipc_test_1' }],
    })
  })

  test('uses a transport control channel for IPC aborts', async () => {
    const { goblinNative, invocations } = loadPreload()

    await goblinNative.abortIpc('ipc_test_1')

    expect(invocations[0]).toEqual({
      channel: IPC_ABORT_CHANNEL,
      args: [{ requestId: 'ipc_test_1' }],
    })
  })

  test('forwards shell bridge calls to their IPC channels', async () => {
    const { goblinNative, invocations } = loadPreload()

    await goblinNative.shell.openSettingsWindow({ page: 'about' })
    await goblinNative.shell.openExternalUrl({ url: 'https://example.com', allowHttp: false })
    await goblinNative.shell.openDirectoryDialog({ title: 'Open Git Repository' })
    await goblinNative.shell.consumeExternalOpenPaths()
    await goblinNative.shell.openInFinder({ path: '/repo' })

    expect(invocations.map((entry) => entry.channel)).toEqual([
      SHELL_OPEN_SETTINGS_WINDOW_CHANNEL,
      SHELL_OPEN_EXTERNAL_URL_CHANNEL,
      SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL,
      SHELL_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
      SHELL_OPEN_IN_FINDER_CHANNEL,
    ])
  })

  test('forwards native terminal notification calls to their IPC channels', async () => {
    const { goblinNative, invocations, sends, ipcRenderer } = loadPreload()

    await goblinNative.terminal.notifyBell({ sessionId: 'term_1', title: 'Goblin', body: 'Bell', repoRoot: '/repo' })
    await goblinNative.terminal.sendTestNotification()
    goblinNative.terminal.setBadge(2)

    expect(invocations.map((entry) => entry.channel)).toEqual([
      TERMINAL_NOTIFY_BELL_CHANNEL,
      TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
    ])
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
    expect(ipcRenderer.on).toHaveBeenCalledWith(IPC_EVENT_CHANNEL, expect.any(Function))

    const listener = ipcRenderer.on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    listener?.(null, { type: 'settings-write-error', message: 'failed' })
    expect(cb1).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    expect(cb2).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })

    off1()
    expect(ipcRenderer.off).not.toHaveBeenCalled()

    off2()
    expect(ipcRenderer.off).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.off).toHaveBeenCalledWith(IPC_EVENT_CHANNEL, listener)
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

    expect(ipcRenderer.on).toHaveBeenCalledWith(RENDERER_EFFECT_INTENT_CHANNEL, expect.any(Function))

    const intentListener = ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === RENDERER_EFFECT_INTENT_CHANNEL,
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    intentListener?.(null, { type: 'external-open-enqueued' })
    expect(cb1).toHaveBeenCalledWith({ type: 'external-open-enqueued' })
    expect(cb2).toHaveBeenCalledWith({ type: 'external-open-enqueued' })

    off1()
    expect(ipcRenderer.off).not.toHaveBeenCalledWith(RENDERER_EFFECT_INTENT_CHANNEL, intentListener)

    off2()
    expect(ipcRenderer.off).toHaveBeenCalledWith(RENDERER_EFFECT_INTENT_CHANNEL, intentListener)
  })
})
