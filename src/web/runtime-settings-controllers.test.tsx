// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

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
  primaryWindowQueryClient.clear()
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
    let controller: ReturnType<typeof useFetchSettingsController> | undefined

    function HookHost() {
      controller = useFetchSettingsController()
      return null
    }

    renderWithPrimaryWindowQueryClient(<HookHost />)

    await act(async () => {
      await controller?.setFetchInterval(300)
      await controller?.setTerminalNotificationsEnabled(true)
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
    let controller: ReturnType<typeof useLanSettingsController> | undefined

    function HookHost() {
      controller = useLanSettingsController()
      return null
    }

    renderWithPrimaryWindowQueryClient(<HookHost />)

    await act(async () => {
      await controller?.setLanEnabled(true)
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('lanEnabled update', expect.any(Function))
    expect(settingsActionsMocks.setLanEnabled).toHaveBeenCalledWith(true)
  })

  test('runs shortcut settings writes through settings mutations', async () => {
    const { useShortcutSettingsController } = await import('#/web/runtime-settings-shortcuts.ts')
    let controller: ReturnType<typeof useShortcutSettingsController> | undefined

    function HookHost() {
      controller = useShortcutSettingsController()
      return null
    }

    renderWithPrimaryWindowQueryClient(<HookHost />)

    let globalShortcutResult: Awaited<ReturnType<NonNullable<typeof controller>['setGlobalShortcut']>> | undefined
    await act(async () => {
      await controller?.setShortcutsDisabled(true)
      await controller?.setGlobalShortcutDisabled(true)
      globalShortcutResult = await controller?.setGlobalShortcut('CommandOrControl+Shift+K')
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
    let controller: ReturnType<typeof useExternalAppSettingsController> | undefined

    function HookHost() {
      controller = useExternalAppSettingsController()
      return null
    }

    renderWithPrimaryWindowQueryClient(<HookHost />)

    await act(async () => {
      await controller?.refreshExternalApps()
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('external app refresh', expect.any(Function))
    expect(settingsActionsMocks.refreshExternalAppsDetection).toHaveBeenCalledTimes(1)
  })

  test('runs GitHub CLI refresh through settings mutations', async () => {
    const { useGitHubSettingsController } = await import('#/web/runtime-settings-github.ts')
    let controller: ReturnType<typeof useGitHubSettingsController> | undefined

    function HookHost() {
      controller = useGitHubSettingsController()
      return null
    }

    renderWithPrimaryWindowQueryClient(<HookHost />)

    await act(async () => {
      await controller?.refreshGitHubCli()
    })

    expect(settingsActionsMocks.runSettingsAction).toHaveBeenCalledWith('GitHub CLI refresh', expect.any(Function))
    expect(settingsActionsMocks.refreshGitHubCliDetection).toHaveBeenCalledTimes(1)
  })
})

function renderWithPrimaryWindowQueryClient(element: React.ReactElement) {
  return renderInJsdom(<QueryClientProvider client={primaryWindowQueryClient}>{element}</QueryClientProvider>)
}
