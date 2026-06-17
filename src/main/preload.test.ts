import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'
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

function loadPreload(options: {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>
  argv?: string[]
} = {}) {
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
    process: { argv: options.argv ?? [] },
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
  test('exposes only the IPC surface, no bootstrap fields', () => {
    // The renderer-side bootstrap is now carried by the HTML
    // (server-injected `<script id="goblin-bootstrap">`), not by the
    // preload. The preload is a strict IPC bridge; tests should fail
    // if it ever starts exposing `runtime` / `homeDir` / `initialI18n`
    // / `initialSettings` again, since that was the original
    // `internalSecret` leak channel that this refactor closed.
    const { goblinNative } = loadPreload()
    expect(goblinNative).not.toHaveProperty('runtime')
    expect(goblinNative).not.toHaveProperty('homeDir')
    expect(goblinNative).not.toHaveProperty('initialI18n')
    expect(goblinNative).not.toHaveProperty('initialSettings')
    expect(goblinNative).not.toHaveProperty('initialServer')
    expect(goblinNative).toHaveProperty('invokeIpc')
    expect(goblinNative).toHaveProperty('abortIpc')
    expect(goblinNative).toHaveProperty('pathForFile')
    expect(goblinNative).toHaveProperty('shell')
    expect(goblinNative).toHaveProperty('terminal')
    expect(goblinNative).toHaveProperty('saveClipboardFiles')
    expect(goblinNative).toHaveProperty('onEvent')
    expect(goblinNative).toHaveProperty('onIntent')
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
