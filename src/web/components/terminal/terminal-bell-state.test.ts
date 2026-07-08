// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalBellState } from '#/web/components/terminal/terminal-bell-state.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'

const descriptor: TerminalDescriptor = {
  terminalSessionId: 'term-111111111111111111111',
  terminalWorktreeKey: 'worktree-key',
  index: 1,
  repoRoot: '/tmp/repo',
  repoInstanceId: 'repo-instance-test',
  branch: 'feature/test',
  worktreePath: '/tmp/repo-worktree',
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  primaryWindowQueryClient.setQueryData(
    settingsSnapshotQueryKey(),
    defaultSettingsSnapshot({ terminalNotificationsEnabled: false }),
  )
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      invokeIpc: vi.fn(),
      abortIpc: vi.fn(),
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
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
    },
  })
})

describe('terminal bell state', () => {
  test('publishes the initial unread count from the source of truth', () => {
    const onBadgeChange = vi.fn()

    createTerminalBellState(vi.fn(), onBadgeChange)

    expect(onBadgeChange).toHaveBeenCalledWith(0)
  })

  test('marks background bells unread and requests a system notification when enabled', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(window.goblinNative.terminal.notifyBell).toHaveBeenCalledWith({
      title: 'repo',
      body: 'feature/test\nzsh',
      terminalSessionId: 'term-111111111111111111111',
      terminalWorktreeKey: 'worktree-key',
      repoRoot: '/tmp/repo',
    })

    hasFocus.mockRestore()
  })

  test('prefers the server terminal title over process name in system notifications', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

    controller.handleBell(descriptor, {
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      visible: false,
    })
    await Promise.resolve()

    expect(window.goblinNative.terminal.notifyBell).toHaveBeenCalledWith({
      title: 'repo',
      body: 'feature/test\n~/Developer/goblin — npm run dev',
      terminalSessionId: 'term-111111111111111111111',
      terminalWorktreeKey: 'worktree-key',
      repoRoot: '/tmp/repo',
    })

    hasFocus.mockRestore()
  })

  test('marks bells unread without requesting a system notification when disabled', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: false }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(window.goblinNative.terminal.notifyBell).not.toHaveBeenCalled()

    hasFocus.mockRestore()
  })

  test('ignores bells from the visible focused terminal', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: true })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(window.goblinNative.terminal.notifyBell).not.toHaveBeenCalled()

    hasFocus.mockRestore()
  })

  test('throttles repeated system notifications for the same terminal', async () => {
    const notify = vi.fn()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const now = vi.spyOn(Date, 'now')
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

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
    expect(window.goblinNative.terminal.notifyBell).toHaveBeenCalledTimes(2)

    now.mockRestore()
    hasFocus.mockRestore()
  })

  test('supports clearing and removing tracked bell state', () => {
    const controller = createTerminalBellState(vi.fn(), vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(true)
    expect(controller.clear(descriptor.terminalSessionId)).toBe(true)
    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(false)

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(true)
    controller.remove(descriptor.terminalSessionId)
    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(false)
  })

  test('reset clears unread and notification debounce state', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const now = vi.spyOn(Date, 'now')
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(vi.fn(), vi.fn())

    now.mockReturnValueOnce(20_000)
    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    controller.reset()
    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(false)

    now.mockReturnValueOnce(21_000)
    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(window.goblinNative.terminal.notifyBell).toHaveBeenCalledTimes(2)

    now.mockRestore()
    hasFocus.mockRestore()
  })
})
