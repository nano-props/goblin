// @vitest-environment jsdom

import i18next from 'i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalBellController } from '#/renderer/components/terminal/terminal-bell-controller.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import type { TerminalDescriptor } from '#/renderer/components/terminal/types.ts'

const descriptor: TerminalDescriptor = {
  key: 'terminal-key',
  groupKey: 'group-key',
  terminalId: 'terminal-1',
  index: 1,
  repoRoot: '/tmp/repo',
  branch: 'feature/test',
  worktreePath: '/tmp/repo-worktree',
}

beforeEach(() => {
  useSettingsStore.setState({ terminalNotificationsEnabled: false })
  i18next.addResourceBundle(
    'en',
    'translation',
    {
      'terminal.index-title': 'Terminal {index}',
      'terminal.bell-notification-title': 'Background terminal alert',
      'terminal.bell-notification-body': '{terminalTitle} · {processName} · {branch}',
    },
    true,
    true,
  )
  Object.defineProperty(window, 'goblin', {
    configurable: true,
    value: {
      homeDir: '/Users/test',
      invokeRpc: vi.fn(),
      abortRpc: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      terminal: {
        notifyBell: vi.fn(async () => true),
      },
    },
  })
})

describe('terminal bell controller', () => {
  test('marks background bells unread and requests a system notification when enabled', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useSettingsStore.setState({ terminalNotificationsEnabled: true })
    const controller = createTerminalBellController(notify)

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.key)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(window.goblin.terminal.notifyBell).toHaveBeenCalledWith({
      title: 'Background terminal alert',
      body: 'Terminal 1 · zsh · feature/test',
    })

    hasFocus.mockRestore()
  })

  test('marks bells unread without requesting a system notification when disabled', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useSettingsStore.setState({ terminalNotificationsEnabled: false })
    const controller = createTerminalBellController(notify)

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
    const controller = createTerminalBellController(notify)

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
    const controller = createTerminalBellController(notify)

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
    const controller = createTerminalBellController(vi.fn())

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
    const controller = createTerminalBellController(vi.fn())

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
