// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const settingsActionsMocks = vi.hoisted(() => ({
  runSettingsAction: vi.fn(async (_label: string, task: () => Promise<unknown>) => await task()),
  setFetchInterval: vi.fn(async () => 120),
  setLanEnabled: vi.fn(async () => {}),
  setTerminalNotificationsEnabled: vi.fn(async () => {}),
}))

vi.mock('#/web/settings-actions.ts', () => settingsActionsMocks)

beforeEach(() => {
  primaryWindowQueryClient.clear()
  settingsActionsMocks.runSettingsAction.mockClear()
  settingsActionsMocks.runSettingsAction.mockImplementation(async (_label, task) => await task())
  settingsActionsMocks.setFetchInterval.mockClear()
  settingsActionsMocks.setFetchInterval.mockResolvedValue(120)
  settingsActionsMocks.setLanEnabled.mockClear()
  settingsActionsMocks.setLanEnabled.mockResolvedValue(undefined)
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
})

function renderWithPrimaryWindowQueryClient(element: React.ReactElement) {
  return renderInJsdom(<QueryClientProvider client={primaryWindowQueryClient}>{element}</QueryClientProvider>)
}
