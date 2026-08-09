import { describe, expect, test } from 'vitest'
import type { UserSettings } from '#/shared/settings.ts'
import { defaultServerWorkspaceState, defaultUserSettings } from '#/shared/settings-defaults.ts'
import { currentSettingsData, type UserSettingsData } from '#/server/modules/user-settings-codec.ts'
import {
  planUserSettingsPatch,
  userSettingsFromData,
  validateUserSettingsPatch,
} from '#/server/modules/user-settings-patch.ts'

const data: UserSettingsData = {
  ...defaultUserSettings(),
  workspace: defaultServerWorkspaceState(),
  recentWorkspaces: [],
  workspaceSettings: [],
}

describe('user settings patch policy', () => {
  test('validates and plans changed preference values without changing workspace state', () => {
    const plan = planUserSettingsPatch(
      data,
      validateUserSettingsPatch({ theme: 'dark', fetchIntervalSec: 42, terminalNotificationsEnabled: true }),
    )

    expect(plan).toMatchObject({ changed: true, fetchIntervalChanged: true })
    expect(plan.next).toMatchObject({ theme: 'dark', fetchIntervalSec: 42, terminalNotificationsEnabled: true })
    expect(plan.next.workspace).toBe(data.workspace)
    expect(plan.next.recentWorkspaces).toBe(data.recentWorkspaces)
  })

  test('preserves the authoritative data object for a no-op patch', () => {
    const plan = planUserSettingsPatch(data, validateUserSettingsPatch({ theme: data.theme }))

    expect(plan).toEqual({ next: data, changed: false, fetchIntervalChanged: false })
  })

  test.each([
    [{ lang: 'unknown' }, 'invalid language'],
    [{ fetchIntervalSec: 1.5 }, 'invalid fetch interval'],
    [{ globalShortcut: 'Control+O' }, 'invalid global shortcut'],
  ] as const)('rejects invalid patch %j at the command boundary', (patch, message) => {
    expect(() => validateUserSettingsPatch(patch as Partial<UserSettings>)).toThrow(message)
  })

  test('projects only public user preference fields', () => {
    expect(userSettingsFromData(data)).toEqual(defaultUserSettings())
  })

  test('preserves the original primitive comparison for negative zero fetch intervals', () => {
    const negativeZeroData = { ...data, fetchIntervalSec: -0 }
    const plan = planUserSettingsPatch(negativeZeroData, validateUserSettingsPatch({ fetchIntervalSec: 0 }))

    expect(plan.changed).toBe(false)
    expect(plan.fetchIntervalChanged).toBe(false)
    expect(plan.next).toBe(negativeZeroData)
  })

  test('normalizes a negative-zero fetch interval at the patch boundary', () => {
    const validated = validateUserSettingsPatch({ fetchIntervalSec: -0 })

    expect(validated.fetchIntervalSec).toBe(0)
    expect(Object.is(validated.fetchIntervalSec, -0)).toBe(false)
  })

  test('normalizes a negative-zero fetch interval at the persistence boundary', () => {
    const decoded = currentSettingsData({ ...data, fetchIntervalSec: -0 })

    expect(decoded).not.toBeNull()
    expect(Object.is(decoded?.fetchIntervalSec, -0)).toBe(false)
    expect(decoded?.fetchIntervalSec).toBe(0)
  })
})
