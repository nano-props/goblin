import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'
import type { RendererBootstrapPayload } from '#/shared/bootstrap.ts'
import {
  RPC_ABORT_CHANNEL,
  RPC_CHANNEL,
  RPC_EVENT_CHANNEL,
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
  return { goblin: exposed.goblin, invocations, sends, ipcRenderer }
}

describe('preload goblin bridge', () => {
  test('exposes bootstrap snapshots parsed from the single preload payload', () => {
    const { goblin } = loadPreload()

    expect(goblin.homeDir).toBe('/home/test')
    expect(goblin.initialI18n).toEqual({ lang: 'en', pref: 'ja', dict: { hello: 'world' } })
    expect(goblin.initialSettings).toMatchObject({
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      editorApp: 'cursor',
    })
  })

  test('falls back cleanly when the bootstrap payload is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { goblin } = loadPreload({ argv: ['--goblin-bootstrap=***not-base64***'] })

    expect(goblin.homeDir).toBe('')
    expect(goblin.initialI18n).toBeNull()
    expect(goblin.initialSettings).toBeNull()
    expect(warn.mock.calls[0]?.[0]).toBe('[preload] failed to parse bootstrap payload')
    expect((warn.mock.calls[0]?.[1] as { name?: string } | undefined)?.name).toBe('SyntaxError')
    warn.mockRestore()
  })

  test('forwards RPC request ids to the main process', async () => {
    const { goblin, invocations } = loadPreload()

    await goblin.invokeRpc({ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'rpc_test_1' })

    expect(invocations[0]).toEqual({
      channel: RPC_CHANNEL,
      args: [{ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'rpc_test_1' }],
    })
  })

  test('uses a transport control channel for RPC aborts', async () => {
    const { goblin, invocations } = loadPreload()

    await goblin.abortRpc('rpc_test_1')

    expect(invocations[0]).toEqual({
      channel: RPC_ABORT_CHANNEL,
      args: [{ requestId: 'rpc_test_1' }],
    })
  })

  test('forwards shell bridge calls to their IPC channels', async () => {
    const { goblin, invocations } = loadPreload()

    await goblin.shell.openSettingsWindow({ page: 'about' })
    await goblin.shell.openExternalUrl({ url: 'https://example.com', allowHttp: false })
    await goblin.shell.openDirectoryDialog({ title: 'Open Git Repository' })
    await goblin.shell.consumeExternalOpenPaths()
    await goblin.shell.openInFinder({ path: '/repo' })

    expect(invocations.map((entry) => entry.channel)).toEqual([
      SHELL_OPEN_SETTINGS_WINDOW_CHANNEL,
      SHELL_OPEN_EXTERNAL_URL_CHANNEL,
      SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL,
      SHELL_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
      SHELL_OPEN_IN_FINDER_CHANNEL,
    ])
  })

  test('forwards native terminal notification calls to their IPC channels', async () => {
    const { goblin, invocations, sends, ipcRenderer } = loadPreload()

    await goblin.terminal.notifyBell({ sessionId: 'term_1', title: 'Goblin', body: 'Bell', repoRoot: '/repo' })
    await goblin.terminal.sendTestNotification()
    goblin.terminal.setBadge(2)

    expect(invocations.map((entry) => entry.channel)).toEqual([
      TERMINAL_NOTIFY_BELL_CHANNEL,
      TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
    ])
    expect(ipcRenderer.on).not.toHaveBeenCalled()
    expect(ipcRenderer.off).not.toHaveBeenCalled()
    expect(sends).toContainEqual({ channel: TERMINAL_SET_BADGE_CHANNEL, args: [2] })
  })

  test('logs failed RPC calls with the request path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { goblin } = loadPreload({
      invoke: () => Promise.resolve({ ok: false, error: { message: 'boom' } }),
    })

    await expect(
      goblin.invokeRpc({ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'rpc_test_1' }),
    ).rejects.toThrow('boom')

    expect(warn.mock.calls[0]?.[0]).toBe('[rpc] repo.status failed')
    expect((warn.mock.calls[0]?.[1] as Error | undefined)?.message).toBe('boom')
    warn.mockRestore()
  })

  test('shares a single goblin:event ipc listener across subscribers', () => {
    const { goblin, ipcRenderer } = loadPreload()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    const off1 = goblin.onEvent(cb1)
    const off2 = goblin.onEvent(cb2)

    expect(ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.on).toHaveBeenCalledWith(RPC_EVENT_CHANNEL, expect.any(Function))

    const listener = ipcRenderer.on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    listener?.(null, { type: 'theme-changed' })
    expect(cb1).toHaveBeenCalledWith({ type: 'theme-changed' })
    expect(cb2).toHaveBeenCalledWith({ type: 'theme-changed' })

    off1()
    expect(ipcRenderer.off).not.toHaveBeenCalled()

    off2()
    expect(ipcRenderer.off).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.off).toHaveBeenCalledWith(RPC_EVENT_CHANNEL, listener)
  })

  test('continues delivering goblin:event when one subscriber throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { goblin, ipcRenderer } = loadPreload()
    const cb1 = vi.fn(() => {
      throw new Error('boom')
    })
    const cb2 = vi.fn()

    goblin.onEvent(cb1)
    goblin.onEvent(cb2)

    const listener = ipcRenderer.on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    listener?.(null, { type: 'theme-changed' })

    expect(cb1).toHaveBeenCalledWith({ type: 'theme-changed' })
    expect(cb2).toHaveBeenCalledWith({ type: 'theme-changed' })
    expect(warn).toHaveBeenCalledWith('[ipc] goblin:event subscriber failed', expect.any(Error))
    expect((warn.mock.calls[0]?.[1] as Error | undefined)?.message).toBe('boom')
    warn.mockRestore()
  })

})
