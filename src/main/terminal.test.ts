import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BrowserWindow, Notification as ElectronNotification } from 'electron'
import { wireTerminalIpc } from '#/main/terminal.ts'
import { registerClientWindowSurface } from '#/main/client-surface-registry.ts'
import { registerTrustedAppUrl } from '#/main/ipc/trusted-webcontents.ts'
import {
  TERMINAL_NOTIFY_BELL_CHANNEL,
  TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
  TERMINAL_SET_BADGE_CHANNEL,
} from '#/shared/ipc-channels.ts'

// `ipcHandlers` is captured by the electron mock factory below, which is
// hoisted to the top of the file by vitest's transformer. Hoist the
// storage too so the factory can write to it before the surrounding
// module body has run.
const { ipcHandlers, mockNotificationEmitting, activatePrimaryWindow, sendPrimaryWindowEffectIntent, showErrorBox } =
  vi.hoisted(() => {
    const ipcHandlers = new Map<string, (_event: unknown, input: unknown) => unknown>()
    const activatedWindow = { id: 'primary-window' }
    const activatePrimaryWindow = vi.fn(async () => activatedWindow)
    const sendPrimaryWindowEffectIntent = vi.fn(async () => {})
    const mockNotificationEmitting = (emitEvent: 'show' | 'failed') =>
      function MockNotification(this: ElectronNotification) {
        const listeners = new Map<string, () => void>()
        this.once = vi.fn((event: string, cb: () => void) => {
          listeners.set(event, cb)
          return this
        }) as unknown as ElectronNotification['once']
        this.show = vi.fn(() => {
          listeners.get(emitEvent)?.()
        })
      }
    return {
      ipcHandlers,
      mockNotificationEmitting,
      activatePrimaryWindow,
      sendPrimaryWindowEffectIntent,
      showErrorBox: vi.fn(),
    }
  })

vi.mock('#/main/window.ts', () => ({ activatePrimaryWindow, sendPrimaryWindowEffectIntent }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, input: unknown) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: (_event: unknown, input: unknown) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
  },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: vi.fn(() => ({ isDestroyed: () => false, isFocused: () => false, flashFrame: vi.fn() })),
  },
  Notification: Object.assign(vi.fn(mockNotificationEmitting('show')), { isSupported: vi.fn(() => true) }),
  app: { name: 'Goblin', on: vi.fn(), getAppPath: vi.fn(() => '/app'), dock: { bounce: vi.fn(), setBadge: vi.fn() } },
  dialog: { showErrorBox },
}))

describe('terminal IPC', () => {
  beforeAll(() => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerClientWindowSurface(
      {
        isDestroyed: () => false,
        webContents: { id: 1, isDestroyed: () => false },
      } as unknown as BrowserWindow,
      { windowKey: 'primary' },
    )
    wireTerminalIpc()
  })

  // The spy has to be re-applied in beforeEach because vitest.config sets
  // `restoreMocks: true`, which restores the original implementation of
  // every spy after each test — a beforeAll spy would be wiped before the
  // second test ran.
  beforeEach(async () => {
    vi.clearAllMocks()
    const { platform } = await import('#/main/platform.ts')
    vi.spyOn(platform, 'isMacOS').mockReturnValue(true)
  })

  test('wires native terminal notification handlers', () => {
    expect(ipcHandlers.has(TERMINAL_NOTIFY_BELL_CHANNEL)).toBe(true)
    expect(ipcHandlers.has(TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL)).toBe(true)
    expect(ipcHandlers.has(TERMINAL_SET_BADGE_CHANNEL)).toBe(true)
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const result = await invokeWithEvent(
      TERMINAL_NOTIFY_BELL_CHANNEL,
      {
        title: 'Terminal bell',
        body: 'zsh needs attention',
        workspaceId: 'goblin+file:///tmp/repo',
      },
      {
        sender: { id: 99, once: vi.fn() },
        senderFrame: { url: 'https://example.com/' },
      },
    )

    expect(result).toBe(false)
  })

  test('rejects malformed bell payloads', async () => {
    await expect(
      invoke(TERMINAL_NOTIFY_BELL_CHANNEL, { title: 1, body: 'bad', workspaceId: 'goblin+file:///tmp/repo' }),
    ).resolves.toBe(false)
    await expect(
      invoke(TERMINAL_NOTIFY_BELL_CHANNEL, { title: 'Terminal bell', body: 'bad', workspaceId: '/tmp/repo' }),
    ).resolves.toBe(false)
  })

  test('rejects malformed test notification payloads', async () => {
    await expect(invoke(TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL, { title: '', body: 'bad' })).resolves.toBe(false)
  })

  test('shows a system notification for trusted bell requests', async () => {
    const { BrowserWindow, Notification, app } = await import('electron')
    const flashFrame = vi.fn()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
      browserWindowFixture({
        isDestroyed: () => false,
        isFocused: () => false,
        flashFrame,
      }),
    )

    await expect(
      invoke(TERMINAL_NOTIFY_BELL_CHANNEL, {
        title: 'Terminal bell',
        body: 'zsh needs attention in feature',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///tmp/repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
        },
      }),
    ).resolves.toBe(true)
    expect(flashFrame).toHaveBeenCalledWith(true)
    expect(app.dock?.bounce).toHaveBeenCalledWith('informational')
    expect(Notification).toHaveBeenCalledWith({
      title: 'Terminal bell',
      body: 'zsh needs attention in feature',
    })
  })

  test('returns false when the notification emits a failed event', async () => {
    const { BrowserWindow, Notification } = await import('electron')
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
      browserWindowFixture({
        isDestroyed: () => false,
        isFocused: () => true,
        flashFrame: vi.fn(),
      }),
    )
    vi.mocked(Notification).mockImplementationOnce(mockNotificationEmitting('failed'))

    await expect(
      invoke(TERMINAL_NOTIFY_BELL_CHANNEL, {
        title: 'Terminal bell',
        body: 'zsh needs attention',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///tmp/repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
        },
      }),
    ).resolves.toBe(false)
  })

  test('forwards terminal presentation when a native notification is clicked', async () => {
    const { Notification } = await import('electron')
    vi.mocked(Notification).mockImplementationOnce(function MockNotification(this: ElectronNotification) {
      const listeners = new Map<string, () => void>()
      this.once = vi.fn((event: string, callback: () => void) => {
        listeners.set(event, callback)
        return this
      }) as unknown as ElectronNotification['once']
      this.show = vi.fn(() => {
        listeners.get('show')?.()
        listeners.get('click')?.()
      })
    })
    const input = {
      title: 'Terminal bell',
      body: 'task completed',
      terminalSessionId: 'term-111111111111111111111',
      session: {
        target: {
          kind: 'git-worktree' as const,
          workspaceId: 'goblin+file:///tmp/repo',
          workspaceRuntimeId: 'workspace-runtime-test',
          root: 'goblin+file:///tmp/repo',
        },
        presentation: { kind: 'git-worktree' as const },
      },
    }

    await expect(invoke(TERMINAL_NOTIFY_BELL_CHANNEL, input)).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(sendPrimaryWindowEffectIntent).toHaveBeenCalledWith({
        type: 'terminal-bell-click',
        terminalSessionId: input.terminalSessionId,
        session: input.session,
      })
    })
  })

  test('activates the primary window when a generic native notification is clicked', async () => {
    const { Notification } = await import('electron')
    vi.mocked(Notification).mockImplementationOnce(function MockNotification(this: ElectronNotification) {
      const listeners = new Map<string, () => void>()
      this.once = vi.fn((event: string, callback: () => void) => {
        listeners.set(event, callback)
        return this
      }) as unknown as ElectronNotification['once']
      this.show = vi.fn(() => {
        listeners.get('show')?.()
        listeners.get('click')?.()
      })
    })

    await expect(
      invoke(TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL, { title: 'Goblin', body: 'Notification test' }),
    ).resolves.toBe(true)
    await vi.waitFor(() => expect(activatePrimaryWindow).toHaveBeenCalledOnce())
    expect(sendPrimaryWindowEffectIntent).not.toHaveBeenCalled()
  })

  test('stops notification navigation when the authoritative window cannot be activated', async () => {
    const { Notification } = await import('electron')
    vi.mocked(Notification).mockImplementationOnce(function MockNotification(this: ElectronNotification) {
      const listeners = new Map<string, () => void>()
      this.once = vi.fn((event: string, callback: () => void) => {
        listeners.set(event, callback)
        return this
      }) as unknown as ElectronNotification['once']
      this.show = vi.fn(() => {
        listeners.get('show')?.()
        listeners.get('click')?.()
      })
    })
    sendPrimaryWindowEffectIntent.mockRejectedValueOnce(new Error('window unavailable'))

    await expect(
      invoke(TERMINAL_NOTIFY_BELL_CHANNEL, {
        title: 'Terminal bell',
        body: 'task completed',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///tmp/repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
        },
      }),
    ).resolves.toBe(true)
    await vi.waitFor(() => expect(sendPrimaryWindowEffectIntent).toHaveBeenCalledOnce())
    expect(activatePrimaryWindow).not.toHaveBeenCalled()
    expect(showErrorBox).toHaveBeenCalledWith('Goblin', expect.stringContaining('try again'))
  })

  test('returns true when Notification.isSupported() is false (flashFrame/bounce already fired)', async () => {
    const { BrowserWindow, Notification } = await import('electron')
    const flashFrame = vi.fn()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
      browserWindowFixture({
        isDestroyed: () => false,
        isFocused: () => false,
        flashFrame,
      }),
    )
    vi.mocked(Notification.isSupported).mockReturnValueOnce(false)

    await expect(
      invoke(TERMINAL_NOTIFY_BELL_CHANNEL, {
        title: 'Terminal bell',
        body: 'zsh needs attention',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///tmp/repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
        },
      }),
    ).resolves.toBe(true)
    expect(flashFrame).toHaveBeenCalledWith(true)
  })

  test('sends the dock badge count through the trusted ipc sender only', async () => {
    const { app } = await import('electron')
    invoke(TERMINAL_SET_BADGE_CHANNEL, 2)
    expect(app.dock?.bounce).not.toHaveBeenCalled()
    expect(app.dock?.setBadge).toHaveBeenCalledWith('2')

    invokeWithEvent(TERMINAL_SET_BADGE_CHANNEL, 4, {
      sender: { id: 99, once: vi.fn() },
      senderFrame: { url: 'https://example.com/' },
    })
    expect(app.dock?.setBadge).toHaveBeenCalledTimes(1)
  })
})

function invoke<TInput>(channel: string, input: TInput): unknown {
  return invokeWithSender(channel, input, { id: 1, once: vi.fn(), isDestroyed: () => false })
}

function invokeWithSender<TInput>(
  channel: string,
  input: TInput,
  sender: { id: number; once: ReturnType<typeof vi.fn>; isDestroyed?: () => boolean },
): unknown {
  return invokeWithEvent(channel, input, {
    sender,
    senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
  })
}

function invokeWithEvent<TInput>(channel: string, input: TInput, event: unknown): unknown {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`missing handler: ${channel}`)
  return handler(event, input)
}

function browserWindowFixture(window: Pick<BrowserWindow, 'isDestroyed' | 'isFocused' | 'flashFrame'>): BrowserWindow {
  return window as BrowserWindow
}
