import { describe, expect, test } from 'vitest'
import { isServerInvalidationEvent, settingsInvalidationScopesForPrefsPatch } from '#/shared/server-invalidation.ts'

describe('settingsInvalidationScopesForPrefsPatch', () => {
  test('always includes the settings snapshot scope', () => {
    expect(settingsInvalidationScopesForPrefsPatch({})).toEqual(['settings-snapshot'])
  })

  test('adds only the derived scopes for changed preference groups', () => {
    expect(
      settingsInvalidationScopesForPrefsPatch({
        lang: 'ko',
        colorTheme: 'macos',
      }),
    ).toEqual(['settings-snapshot', 'i18n', 'theme'])
  })
})

describe('workspace runtime invalidation', () => {
  test('accepts canonical workspace identities and rejects native paths', () => {
    expect(
      isServerInvalidationEvent({
        type: 'workspace-runtime-invalidated',
        workspaceId: 'goblin+ssh://example/workspace',
      }),
    ).toBe(true)
    expect(isServerInvalidationEvent({ type: 'workspace-runtime-invalidated', workspaceId: '/workspace' })).toBe(false)
  })
})
