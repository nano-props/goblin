// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { checkArchitectureSources } from '../../scripts/check-architecture.ts'

describe('architecture boundary rules', () => {
  test('allows only approved settings-client symbols in settings read boundaries', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/settings-queries.ts',
          source: "import { getSettingsSnapshot } from '#/web/settings-client.ts'\n",
        },
      ]),
    ).toEqual([])

    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/settings-queries.ts',
          source: "import { getSettingsSnapshot, setThemePref } from '#/web/settings-client.ts'\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining('/src/web/settings-queries.ts: disallowed import "#/web/settings-client.ts"'),
    ])
  })

  test('rejects settings-client imports from unapproved web files', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/components/settings/GeneralSettings.tsx',
          source: "import { setThemePref } from '#/web/settings-client.ts'\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining(
        '/src/web/components/settings/GeneralSettings.tsx: disallowed import "#/web/settings-client.ts"',
      ),
    ])
  })

  test('rejects relative imports that resolve to settings-client', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/components/settings/GeneralSettings.tsx',
          source: "import { setThemePref } from '../../settings-client.ts'\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining(
        '/src/web/components/settings/GeneralSettings.tsx: disallowed import "../../settings-client.ts"',
      ),
    ])
  })
})
