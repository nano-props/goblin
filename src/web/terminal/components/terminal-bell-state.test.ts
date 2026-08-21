// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalBellState } from '#/web/terminal/components/terminal-bell-state.ts'
import { terminalDescriptorForTest } from '#/web/test-utils/terminal-model.ts'
import { terminalSessionBase } from '#/shared/terminal-types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { settingsSnapshotQueryKey } from '#/web/settings/query-cache.ts'
import { terminalClient } from '#/web/terminal/client-facade.ts'

const descriptor = terminalDescriptorForTest({
  terminalSessionId: 'term-111111111111111111111',
  index: 1,
  repoRoot: '/tmp/repo',
  workspaceRuntimeId: 'repo-runtime-test',
  branch: 'feature/test',
  worktreePath: '/tmp/repo-worktree',
})

beforeEach(() => {
  appQueryClient.clear()
  appQueryClient.setQueryData(
    settingsSnapshotQueryKey(),
    defaultSettingsSnapshot({ terminalNotificationsEnabled: false }),
  )
  vi.spyOn(terminalClient, 'notifyBell').mockResolvedValue(true)
})

afterEach(() => vi.restoreAllMocks())

describe('terminal bell state', () => {
  test('publishes the initial unread count from the source of truth', () => {
    const onBadgeChange = vi.fn()

    createTerminalBellState(vi.fn(), onBadgeChange)

    expect(onBadgeChange).toHaveBeenCalledWith(0)
  })

  test('marks background bells unread and requests a system notification when enabled', async () => {
    const notify = vi.fn()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    appQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(terminalClient.notifyBell).toHaveBeenCalledWith({
      title: 'repo',
      body: 'zsh',
      terminalSessionId: 'term-111111111111111111111',
      session: terminalSessionBase(descriptor.target, descriptor.presentation),
    })

  })

  test('prefers the server terminal title over process name in system notifications', async () => {
    const notify = vi.fn()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    appQueryClient.setQueryData(
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

    expect(terminalClient.notifyBell).toHaveBeenCalledWith({
      title: 'repo',
      body: '~/Developer/goblin — npm run dev',
      terminalSessionId: 'term-111111111111111111111',
      session: terminalSessionBase(descriptor.target, descriptor.presentation),
    })

  })

  test.each([
    ['/tmp/My Workspace', 'My Workspace'],
    ['goblin+file:///C:/', 'C:\\'],
  ])('derives the system notification title from canonical workspace identity', async (repoRoot, title) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    appQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(vi.fn(), vi.fn())
    const workspaceDescriptor = terminalDescriptorForTest({
      terminalSessionId: 'term-222222222222222222222',
      index: 1,
      repoRoot,
      workspaceRuntimeId: 'repo-runtime-test',
      branch: null,
      worktreePath: repoRoot,
    })

    controller.handleBell(workspaceDescriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(terminalClient.notifyBell).toHaveBeenCalledWith(expect.objectContaining({ title }))
  })

  test('marks bells unread without requesting a system notification when disabled', async () => {
    const notify = vi.fn()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    appQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: false }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: false })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(terminalClient.notifyBell).not.toHaveBeenCalled()

  })

  test('ignores bells from the visible focused terminal', async () => {
    const notify = vi.fn()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    appQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const controller = createTerminalBellState(notify, vi.fn())

    controller.handleBell(descriptor, { processName: 'zsh', visible: true })
    await Promise.resolve()

    expect(controller.hasBell(descriptor.terminalSessionId)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(terminalClient.notifyBell).not.toHaveBeenCalled()

  })

  test('throttles repeated system notifications for the same terminal', async () => {
    const notify = vi.fn()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const now = vi.spyOn(Date, 'now')
    appQueryClient.setQueryData(
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
    expect(terminalClient.notifyBell).toHaveBeenCalledTimes(2)

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
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const now = vi.spyOn(Date, 'now')
    appQueryClient.setQueryData(
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

    expect(terminalClient.notifyBell).toHaveBeenCalledTimes(2)

  })
})
