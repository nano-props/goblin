// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { appQueryClient } from '#/web/app-query-client.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { renderHookInJsdom } from '#/test-utils/render.tsx'

const settingsActionsMocks = vi.hoisted(() => ({
  refreshExternalAppsDetection: vi.fn(async () => {}),
  refreshGitHubCliDetection: vi.fn(async () => {}),
  runSettingsAction: vi.fn(async (_label: string, task: () => Promise<unknown>) => await task()),
  setFetchInterval: vi.fn(async () => 120),
  setGlobalShortcut: vi.fn(async (accelerator: string) => ({ accelerator, registered: true })),
  setGlobalShortcutDisabled: vi.fn(async () => {}),
  setLanEnabled: vi.fn(async () => {}),
  setShortcutsDisabled: vi.fn(async () => {}),
  setTerminalNotificationsEnabled: vi.fn(async () => {}),
}))

vi.mock('#/web/settings-actions.ts', () => settingsActionsMocks)

beforeEach(() => {
  appQueryClient.clear()
  settingsActionsMocks.refreshExternalAppsDetection.mockClear()
  settingsActionsMocks.refreshExternalAppsDetection.mockResolvedValue(undefined)
  settingsActionsMocks.refreshGitHubCliDetection.mockClear()
  settingsActionsMocks.refreshGitHubCliDetection.mockResolvedValue(undefined)
  settingsActionsMocks.runSettingsAction.mockClear()
  settingsActionsMocks.runSettingsAction.mockImplementation(async (_label, task) => await task())
  settingsActionsMocks.setFetchInterval.mockClear()
  settingsActionsMocks.setFetchInterval.mockResolvedValue(120)
  settingsActionsMocks.setGlobalShortcut.mockClear()
  settingsActionsMocks.setGlobalShortcut.mockImplementation(async (accelerator) => ({ accelerator, registered: true }))
  settingsActionsMocks.setGlobalShortcutDisabled.mockClear()
  settingsActionsMocks.setGlobalShortcutDisabled.mockResolvedValue(undefined)
  settingsActionsMocks.setLanEnabled.mockClear()
  settingsActionsMocks.setLanEnabled.mockResolvedValue(undefined)
  settingsActionsMocks.setShortcutsDisabled.mockClear()
  settingsActionsMocks.setShortcutsDisabled.mockResolvedValue(undefined)
  settingsActionsMocks.setTerminalNotificationsEnabled.mockClear()
  settingsActionsMocks.setTerminalNotificationsEnabled.mockResolvedValue(undefined)
})

describe('runtime settings controllers', () => {
  test('runs fetch settings writes through settings mutations', async () => {
    const { useFetchSettingsController } = await import('#/web/runtime-settings-fetch.ts')
    const { result } = renderHookInJsdom(() => useFetchSettingsController(), { wrapper: AppQueryClientProvider })

    await act(async () => {
      await result.current.setFetchInterval(300)
      await result.current.setTerminalNotificationsEnabled(true)
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('fetch interval update', expect.any(Function))
    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith(
      'terminal notifications update',
      expect.any(Function),
    )
    expect(settingsActionsMocks.setFetchInterval).toHaveBeenCalledWith(300)
    expect(settingsActionsMocks.setTerminalNotificationsEnabled).toHaveBeenCalledWith(true)
  })

  test('runs LAN settings writes through settings mutations', async () => {
    const { useLanSettingsController } = await import('#/web/runtime-settings-lan.ts')
    const { result } = renderHookInJsdom(() => useLanSettingsController(), { wrapper: AppQueryClientProvider })

    await act(async () => {
      await result.current.setLanEnabled(true)
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('lanEnabled update', expect.any(Function))
    expect(settingsActionsMocks.setLanEnabled).toHaveBeenCalledWith(true)
  })

  test('runs shortcut settings writes through settings mutations', async () => {
    const { useShortcutSettingsController } = await import('#/web/runtime-settings-shortcuts.ts')
    const { result } = renderHookInJsdom(() => useShortcutSettingsController(), { wrapper: AppQueryClientProvider })

    const globalShortcutResult = await act(async () => {
      await result.current.setShortcutsDisabled(true)
      await result.current.setGlobalShortcutDisabled(true)
      return await result.current.setGlobalShortcut('CommandOrControl+Shift+K')
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('shortcuts update', expect.any(Function))
    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith(
      'global shortcut disabled update',
      expect.any(Function),
    )
    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('global shortcut update', expect.any(Function))
    expect(settingsActionsMocks.setShortcutsDisabled).toHaveBeenCalledWith(true)
    expect(settingsActionsMocks.setGlobalShortcutDisabled).toHaveBeenCalledWith(true)
    expect(settingsActionsMocks.setGlobalShortcut).toHaveBeenCalledWith('CommandOrControl+Shift+K')
    expect(globalShortcutResult).toEqual({ accelerator: 'CommandOrControl+Shift+K', registered: true })
  })

  test('runs external app refresh through settings mutations', async () => {
    const { useExternalAppSettingsController } = await import('#/web/runtime-settings-external-apps.ts')
    const { result } = renderHookInJsdom(() => useExternalAppSettingsController(), { wrapper: AppQueryClientProvider })

    await act(async () => {
      await result.current.refreshExternalApps()
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('external app refresh', expect.any(Function))
    expect(settingsActionsMocks.refreshExternalAppsDetection).toHaveBeenCalledTimes(1)
  })

  test('coalesces concurrent external app refreshes', async () => {
    const { useExternalAppSettingsController } = await import('#/web/runtime-settings-external-apps.ts')
    const refresh = Promise.withResolvers<void>()
    settingsActionsMocks.refreshExternalAppsDetection.mockImplementation(async () => await refresh.promise)
    const { result } = renderHookInJsdom(() => useExternalAppSettingsController(), { wrapper: AppQueryClientProvider })

    const { firstRefresh, secondRefresh } = await act(async () => {
      const firstRefresh = result.current.refreshExternalApps()
      const secondRefresh = result.current.refreshExternalApps()
      await flushMicrotasks()
      return { firstRefresh, secondRefresh }
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledTimes(1)
    expect(settingsActionsMocks.refreshExternalAppsDetection).toHaveBeenCalledTimes(1)

    refresh.resolve()
    await act(async () => {
      await Promise.all([firstRefresh, secondRefresh])
    })
  })

  test('runs GitHub CLI refresh through settings mutations', async () => {
    const { useGitHubSettingsController } = await import('#/web/runtime-settings-github.ts')
    const { result } = renderHookInJsdom(() => useGitHubSettingsController(), { wrapper: AppQueryClientProvider })

    await act(async () => {
      await result.current.refreshGitHubCli()
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('GitHub CLI refresh', expect.any(Function))
    expect(settingsActionsMocks.refreshGitHubCliDetection).toHaveBeenCalledTimes(1)
  })

  test('coalesces concurrent GitHub CLI refreshes', async () => {
    const { useGitHubSettingsController } = await import('#/web/runtime-settings-github.ts')
    const refresh = Promise.withResolvers<void>()
    settingsActionsMocks.refreshGitHubCliDetection.mockImplementation(async () => await refresh.promise)
    const { result } = renderHookInJsdom(() => useGitHubSettingsController(), { wrapper: AppQueryClientProvider })

    const { firstRefresh, secondRefresh } = await act(async () => {
      const firstRefresh = result.current.refreshGitHubCli()
      const secondRefresh = result.current.refreshGitHubCli()
      await flushMicrotasks()
      return { firstRefresh, secondRefresh }
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledTimes(1)
    expect(settingsActionsMocks.refreshGitHubCliDetection).toHaveBeenCalledTimes(1)

    refresh.resolve()
    await act(async () => {
      await Promise.all([firstRefresh, secondRefresh])
    })
  })
})

function AppQueryClientProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
}
