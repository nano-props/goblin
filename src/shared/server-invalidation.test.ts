import { describe, expect, test } from 'vitest'
import { settingsInvalidationScopesForPrefsPatch } from '#/shared/server-invalidation.ts'

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
