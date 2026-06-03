// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalBellController } from '#/web/components/terminal/terminal-bell-controller.ts'
import { useSettingsStore } from '#/web/stores/settings.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

const descriptor: TerminalDescriptor = {
  key: 'terminal-key',
  worktreeTerminalKey: 'worktree-key',
  terminalId: 'terminal-1',
  index: 1,
  repoRoot: '/tmp/repo',
  branch: 'feature/test',
  worktreePath: '/tmp/repo-worktree',
}

beforeEach(() => {
  useSettingsStore.setState({ terminalNotificationsEnabled: false })
  Object.defineProperty(window, 'goblin', {
    configurable: true,
    value: {
      homeDir: '/Users/test',
      initialI18n: null,
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
      invokeRpc: vi.fn(),
      abortRpc: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      terminal: {
        notifyBell: vi.fn(async () => true),
        setBadge: vi.fn(async () => {}),
      },
    },
  })
  Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
    configurable: true,
    value: {
      homeDir: '/Users/test',
      initialI18n: null,
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
    },
  })
})

describe('terminal bell controller', () => {
  test('marks background bells unread and requests a system notification when enabled', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useSettingsStore.setState({ terminalNotificationsEnabled: true })
    const controller = createTerminalBellController(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.key)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(window.goblin.terminal.notifyBell).toHaveBeenCalledWith({
      title: 'repo',
      body: 'feature/test\nzsh',
      key: 'terminal-key',
      repoRoot: '/tmp/repo',
    })

    hasFocus.mockRestore()
  })

  test('prefers the server terminal title over process name in system notifications', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useSettingsStore.setState({ terminalNotificationsEnabled: true })
    const controller = createTerminalBellController(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', canonicalTitle: '~/Developer/goblin — npm run dev', visible: false })
    await Promise.resolve()

    expect(window.goblin.terminal.notifyBell).toHaveBeenCalledWith({
      title: 'repo',
      body: 'feature/test\n~/Developer/goblin — npm run dev',
      key: 'terminal-key',
      repoRoot: '/tmp/repo',
    })

    hasFocus.mockRestore()
  })

  test('marks bells unread without requesting a system notification when disabled', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useSettingsStore.setState({ terminalNotificationsEnabled: false })
    const controller = createTerminalBellController(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.key)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(window.goblin.terminal.notifyBell).not.toHaveBeenCalled()

    hasFocus.mockRestore()
  })

  test('ignores bells from the visible focused terminal', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    useSettingsStore.setState({ terminalNotificationsEnabled: true })
    const controller = createTerminalBellController(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: true })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.key)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(window.goblin.terminal.notifyBell).not.toHaveBeenCalled()

    hasFocus.mockRestore()
  })

  test('debounces repeated system notifications for the same terminal', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const now = vi.spyOn(Date, 'now')
    useSettingsStore.setState({ terminalNotificationsEnabled: true })
    const controller = createTerminalBellController(notify, vi.fn())

    now.mockReturnValueOnce(10_000)
    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    now.mockReturnValueOnce(12_000)
    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    now.mockReturnValueOnce(16_000)
    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(notify).toHaveBeenCalledTimes(1)
    expect(window.goblin.terminal.notifyBell).toHaveBeenCalledTimes(2)

    now.mockRestore()
    hasFocus.mockRestore()
  })

  test('supports clearing and removing tracked bell state', () => {
    const controller = createTerminalBellController(vi.fn(), vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    expect(controller.hasBell(descriptor.key)).toBe(true)
    expect(controller.clear(descriptor.key)).toBe(true)
    expect(controller.hasBell(descriptor.key)).toBe(false)

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    expect(controller.hasBell(descriptor.key)).toBe(true)
    controller.remove(descriptor.key)
    expect(controller.hasBell(descriptor.key)).toBe(false)
  })

  test('reset clears unread and notification debounce state', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const now = vi.spyOn(Date, 'now')
    useSettingsStore.setState({ terminalNotificationsEnabled: true })
    const controller = createTerminalBellController(vi.fn(), vi.fn())

    now.mockReturnValueOnce(20_000)
    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    controller.reset()
    expect(controller.hasBell(descriptor.key)).toBe(false)

    now.mockReturnValueOnce(21_000)
    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(window.goblin.terminal.notifyBell).toHaveBeenCalledTimes(2)

    now.mockRestore()
    hasFocus.mockRestore()
  })
})
