import * as v from 'valibot'
import { describe, expect, test } from 'vitest'
import { defaultSettingsSnapshot, defaultUserSettings } from '#/shared/settings-defaults.ts'
import {
  GlobalShortcutStateResponseSchema,
  SettingsSnapshotSchema,
  UserSettingsSchema,
  UserSettingsUpdateResponseSchema,
  WorkspaceRestoreResponseSchema,
} from '#/shared/settings-response-schema.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('settings response schemas', () => {
  test('accepts current settings response contracts', () => {
    const prefs = defaultUserSettings({ globalShortcut: 'Alt+K' })
    expect(v.parse(UserSettingsSchema, prefs)).toEqual(prefs)
    expect(v.parse(SettingsSnapshotSchema, defaultSettingsSnapshot(prefs))).toEqual(defaultSettingsSnapshot(prefs))
    expect(v.parse(UserSettingsUpdateResponseSchema, { ok: true, prefs })).toEqual({ ok: true, prefs })
    expect(v.parse(GlobalShortcutStateResponseSchema, { ok: true, registered: true })).toEqual({
      ok: true,
      registered: true,
    })
  })

  test.each([
    ['missing field', { ...defaultUserSettings(), lang: undefined }],
    ['invalid fetch interval', { ...defaultUserSettings(), fetchIntervalSec: 1.5 }],
    ['invalid shortcut', { ...defaultUserSettings(), globalShortcut: 'not a shortcut' }],
    ['unknown field', { ...defaultUserSettings(), legacyTheme: 'dark' }],
  ])('rejects %s in user settings', (_name, input) => {
    expect(v.safeParse(UserSettingsSchema, input).success).toBe(false)
  })

  test('rejects malformed nested settings snapshot state', () => {
    const snapshot = defaultSettingsSnapshot()
    const malformedRecent = { ...snapshot, recentWorkspaces: [{ id: 'relative/path' }] }
    expect(v.safeParse(SettingsSnapshotSchema, malformedRecent).success).toBe(false)

    const malformedWorkspaceSettings = {
      ...snapshot,
      workspaceSettings: [
        {
          workspaceId: 'file:///workspace',
          workspaceExternalAppRecent: { byTarget: { 'git-branch:main': 'editor:vscode' } },
        },
      ],
    }
    expect(v.safeParse(SettingsSnapshotSchema, malformedWorkspaceSettings).success).toBe(false)
  })

  test('rejects incomplete and extended command responses', () => {
    expect(v.safeParse(UserSettingsUpdateResponseSchema, { prefs: defaultUserSettings() }).success).toBe(false)
    expect(
      v.safeParse(UserSettingsUpdateResponseSchema, {
        ok: true,
        prefs: defaultUserSettings(),
        externalApps: {},
      }).success,
    ).toBe(false)
    expect(v.safeParse(GlobalShortcutStateResponseSchema, { ok: true }).success).toBe(false)
    expect(v.safeParse(GlobalShortcutStateResponseSchema, { ok: true, registered: true, legacy: true }).success).toBe(
      false,
    )
  })

  test('accepts a deferred Git workspace stub without a repo projection', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///deferred-repo')
    const response = {
      status: 'restored',
      openWorkspaceEntries: [{ id: workspaceId }],
      runtime: {
        workspaces: [
          {
            workspaceId,
            workspaceRuntimeId: 'runtime_test000000000000',
            name: 'deferred-repo',
            entry: { id: workspaceId },
            transport: { kind: 'file' },
            workspaceProbe: {
              status: 'ready',
              name: 'deferred-repo',
              capabilities: {
                files: { read: true, write: true },
                terminal: { available: true },
                git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
              },
              diagnostics: [],
            },
            gitProjection: null,
          },
        ],
        workspacePaneTabs: [],
        restoredWorkspaceId: workspaceId,
      },
    }

    expect(v.parse(WorkspaceRestoreResponseSchema, response)).toEqual(response)
  })
})
