import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { registerTrustedAppUrl, registerTrustedWebContents } from '#/main/ipc/trusted-webcontents.ts'
import { wireShellBridgeIpc } from '#/main/shell-bridge.ts'
import {
  SHELL_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
  SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL,
  SHELL_OPEN_EXTERNAL_URL_CHANNEL,
  SHELL_OPEN_SETTINGS_WINDOW_CHANNEL,
} from '#/shared/ipc-channels.ts'

const {
  ipcHandlers,
  browserWindowFromWebContents,
  showOpenDialog,
  sendRpcEvent,
  activateMainWindow,
} = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (_event: unknown, input: any) => unknown>(),
  browserWindowFromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
  sendRpcEvent: vi.fn(),
  activateMainWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, input: any) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
  },
  BrowserWindow: { fromWebContents: browserWindowFromWebContents },
  dialog: { showOpenDialog },
  shell: { showItemInFolder: vi.fn() },
}))

vi.mock('#/main/window.ts', () => ({
  activateMainWindow,
  getMainWindow: vi.fn(() => null),
}))

vi.mock('#/main/events.ts', () => ({
  sendRpcEvent,
}))

const trustedSender = { id: 1, once: vi.fn() }
const trustedEvent = {
  sender: trustedSender,
  senderFrame: { url: 'http://127.0.0.1:5173/' },
} as any

describe('shell bridge IPC', () => {
  beforeAll(() => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents(trustedSender as any)
    wireShellBridgeIpc()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('wires shell bridge handlers', () => {
    expect(ipcHandlers.has(SHELL_OPEN_SETTINGS_WINDOW_CHANNEL)).toBe(true)
    expect(ipcHandlers.has(SHELL_OPEN_EXTERNAL_URL_CHANNEL)).toBe(true)
    expect(ipcHandlers.has(SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL)).toBe(true)
    expect(ipcHandlers.has(SHELL_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL)).toBe(true)
  })

  test('parents directory dialogs to the sender window', async () => {
    const senderWindow = {} as any
    browserWindowFromWebContents.mockReturnValue(senderWindow)
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/repo'] })

    const result = await invoke(SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL, { title: 'Open Git Repository' })

    expect(result).toBe('/repo')
    expect(browserWindowFromWebContents).toHaveBeenCalledWith(trustedSender)
    expect(showOpenDialog).toHaveBeenCalledWith(senderWindow, {
      properties: ['openDirectory'],
      title: 'Open Git Repository',
    })
  })

  test('opens settings through a menu-action on the activated main window', async () => {
    const mainWindow = {} as any
    activateMainWindow.mockResolvedValue(mainWindow)

    const result = await invoke(SHELL_OPEN_SETTINGS_WINDOW_CHANNEL, { page: 'about' })

    expect(result).toBe(true)
    expect(sendRpcEvent).toHaveBeenCalledWith(mainWindow, {
      type: 'menu-action',
      action: { type: 'open-settings', page: 'about' },
    })
  })

  test('rejects untrusted shell bridge senders', async () => {
    const result = await invokeWithEvent(SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL, { title: 'Open Git Repository' }, {
      sender: { id: 99, once: vi.fn() },
      senderFrame: { url: 'https://example.com/' },
    } as any)

    expect(result).toBeNull()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})

async function invoke<TInput>(channel: string, input?: TInput) {
  return await invokeWithEvent(channel, input, trustedEvent)
}

async function invokeWithEvent<TInput>(channel: string, input: TInput, event: unknown) {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler for ${channel}`)
  return await handler(event, input)
}
