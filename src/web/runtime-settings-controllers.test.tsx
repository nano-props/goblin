// @vitest-environment jsdom

import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { appQueryClient } from '#/web/app-query-client.ts'
import { CodedError } from '#/shared/coded-error.ts'

const settingsActionsMocks = vi.hoisted(() => ({
  refreshExternalAppsDetection: vi.fn(async () => {}),
  refreshGitHubCliDetection: vi.fn(async () => {}),
  setFetchInterval: vi.fn(async () => 120),
  setGlobalShortcut: vi.fn(async (accelerator: string) => ({
    kind: 'projected' as const,
    accelerator,
    registered: true,
  })),
  setGlobalShortcutDisabled: vi.fn(async () => {}),
  setLanEnabled: vi.fn(async () => {}),
  setShortcutsDisabled: vi.fn(async () => {}),
  setTerminalNotificationsEnabled: vi.fn(async () => {}),
}))

const feedbackMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))

vi.mock('#/web/settings-actions.ts', () => settingsActionsMocks)
vi.mock('vue-sonner', () => ({ toast: feedbackMocks }))

beforeEach(() => {
  appQueryClient.clear()
  settingsActionsMocks.refreshExternalAppsDetection.mockClear()
  settingsActionsMocks.refreshExternalAppsDetection.mockResolvedValue(undefined)
  settingsActionsMocks.refreshGitHubCliDetection.mockClear()
  settingsActionsMocks.refreshGitHubCliDetection.mockResolvedValue(undefined)
  feedbackMocks.error.mockClear()
  feedbackMocks.warning.mockClear()
  settingsActionsMocks.setFetchInterval.mockClear()
  settingsActionsMocks.setFetchInterval.mockResolvedValue(120)
  settingsActionsMocks.setGlobalShortcut.mockClear()
  settingsActionsMocks.setGlobalShortcut.mockImplementation(async (accelerator) => ({
    kind: 'projected',
    accelerator,
    registered: true,
  }))
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
    const { result } = renderComposableInJsdom(() => useFetchSettingsController(), { wrapper: AppVueQueryClientScope })

    result.value.setFetchInterval(300)
    result.value.setTerminalNotificationsEnabled(true)
    await vi.waitFor(() => {
      expect(settingsActionsMocks.setFetchInterval).toHaveBeenCalledWith(300)
      expect(settingsActionsMocks.setTerminalNotificationsEnabled).toHaveBeenCalledWith(true)
    })

    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })

  test('runs LAN settings writes through settings mutations', async () => {
    const { useLanSettingsController } = await import('#/web/runtime-settings-lan.ts')
    const { result } = renderComposableInJsdom(() => useLanSettingsController(), { wrapper: AppVueQueryClientScope })

    result.value.setLanEnabled(true)
    await vi.waitFor(() => expect(settingsActionsMocks.setLanEnabled).toHaveBeenCalledWith(true))

    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })

  test('surfaces a rejected settings write once at the settings interaction boundary', async () => {
    settingsActionsMocks.setLanEnabled.mockRejectedValueOnce(new Error('settings unavailable'))
    const { useLanSettingsController } = await import('#/web/runtime-settings-lan.ts')
    const { result } = renderComposableInJsdom(() => useLanSettingsController(), { wrapper: AppVueQueryClientScope })

    result.value.setLanEnabled(true)

    await vi.waitFor(() => {
      expect(feedbackMocks.error).toHaveBeenCalledWith(expect.any(String), { id: 'settings-write-failed' })
    })
    expect(feedbackMocks.warning).not.toHaveBeenCalled()
  })

  test('surfaces an uncertain settings write without reporting a rejection', async () => {
    settingsActionsMocks.setLanEnabled.mockRejectedValueOnce(
      new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'settings outcome uncertain' }),
    )
    const { useLanSettingsController } = await import('#/web/runtime-settings-lan.ts')
    const { result } = renderComposableInJsdom(() => useLanSettingsController(), { wrapper: AppVueQueryClientScope })

    result.value.setLanEnabled(true)

    await vi.waitFor(() => {
      expect(feedbackMocks.warning).toHaveBeenCalledWith(expect.any(String), {
        id: 'settings-operation-outcome-uncertain',
      })
    })
    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })

  test('runs shortcut settings writes through settings mutations', async () => {
    const { useShortcutSettingsController } = await import('#/web/runtime-settings-shortcuts.ts')
    const { result } = renderComposableInJsdom(() => useShortcutSettingsController(), {
      wrapper: AppVueQueryClientScope,
    })

    const onShortcutSaved = vi.fn()
    result.value.setShortcutsDisabled(true)
    result.value.setGlobalShortcutDisabled(true)
    result.value.setGlobalShortcut('CommandOrControl+Shift+K', onShortcutSaved)
    await vi.waitFor(() => {
      expect(settingsActionsMocks.setShortcutsDisabled).toHaveBeenCalledWith(true)
      expect(settingsActionsMocks.setGlobalShortcutDisabled).toHaveBeenCalledWith(true)
      expect(settingsActionsMocks.setGlobalShortcut).toHaveBeenCalledWith('CommandOrControl+Shift+K')
      expect(onShortcutSaved).toHaveBeenCalledWith({
        kind: 'projected',
        accelerator: 'CommandOrControl+Shift+K',
        registered: true,
      })
    })

    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })

  test('runs external app refresh through settings mutations', async () => {
    const { useExternalAppSettingsController } = await import('#/web/runtime-settings-external-apps.ts')
    const { result } = renderComposableInJsdom(() => useExternalAppSettingsController(), {
      wrapper: AppVueQueryClientScope,
    })

    result.value.refreshExternalApps()
    await vi.waitFor(() => expect(settingsActionsMocks.refreshExternalAppsDetection).toHaveBeenCalledTimes(1))

    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })

  test('coalesces concurrent external app refreshes', async () => {
    const { useExternalAppSettingsController } = await import('#/web/runtime-settings-external-apps.ts')
    const refresh = Promise.withResolvers<void>()
    settingsActionsMocks.refreshExternalAppsDetection.mockImplementation(async () => await refresh.promise)
    const { result } = renderComposableInJsdom(() => useExternalAppSettingsController(), {
      wrapper: AppVueQueryClientScope,
    })

    result.value.refreshExternalApps()
    result.value.refreshExternalApps()
    await vi.waitFor(() => expect(settingsActionsMocks.refreshExternalAppsDetection).toHaveBeenCalledTimes(1))

    refresh.resolve()
    await vi.waitFor(() => expect(result.value.refreshing.value).toBe(false))
  })

  test('runs GitHub CLI refresh through settings mutations', async () => {
    const { useGitHubSettingsController } = await import('#/web/runtime-settings-github.ts')
    const { result } = renderComposableInJsdom(() => useGitHubSettingsController(), { wrapper: AppVueQueryClientScope })

    result.value.refreshGitHubCli()
    await vi.waitFor(() => expect(settingsActionsMocks.refreshGitHubCliDetection).toHaveBeenCalledTimes(1))

    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })

  test('coalesces concurrent GitHub CLI refreshes', async () => {
    const { useGitHubSettingsController } = await import('#/web/runtime-settings-github.ts')
    const refresh = Promise.withResolvers<void>()
    settingsActionsMocks.refreshGitHubCliDetection.mockImplementation(async () => await refresh.promise)
    const { result } = renderComposableInJsdom(() => useGitHubSettingsController(), { wrapper: AppVueQueryClientScope })

    result.value.refreshGitHubCli()
    result.value.refreshGitHubCli()
    await vi.waitFor(() => expect(settingsActionsMocks.refreshGitHubCliDetection).toHaveBeenCalledTimes(1))

    refresh.resolve()
    await vi.waitFor(() => expect(result.value.refreshingGitHubCli.value).toBe(false))
  })
})

const AppVueQueryClientScope = defineComponent({
  name: 'AppVueQueryClientScope',
  setup(_props, { slots }) {
    return () => <VueQueryClientScope client={appQueryClient}>{slots.default?.()}</VueQueryClientScope>
  },
})
