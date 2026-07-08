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
    ).toEqual([expect.stringContaining('/src/web/settings-queries.ts: disallowed import "#/web/settings-client.ts"')])
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

  test('rejects legacy direct repo read surfaces in web code', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/repo-client.ts',
          source: "await requestGoblin('repo.status', { cwd })\n",
        },
        {
          relativeFilePath: '/src/web/repo-client.ts',
          source: "await postServerJson('/api/repo/snapshot', { cwd })\n",
        },
        {
          relativeFilePath: '/src/web/repo-client.ts',
          source: 'await getRepoSnapshot(cwd)\n',
        },
        {
          relativeFilePath: '/src/web/repo-client.ts',
          source: 'const schema = REPO_PROCEDURE_SCHEMAS.status\n',
        },
      ]),
    ).toEqual([
      expect.stringContaining('legacy repo IPC read route'),
      expect.stringContaining('legacy repo HTTP read route'),
      expect.stringContaining('legacy repo read helper'),
      expect.stringContaining('legacy repo procedure schema key'),
    ])
  })

  test('allows projection payload and invalidation names in web code', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/repo-branch-read-model.ts',
          source: "repoBranchReadModelFromSnapshot(projection.snapshot, projection.status)\n",
        },
        {
          relativeFilePath: '/src/web/hooks/useRepoStoreInvalidationRefresh.ts',
          source: "if (event.query === 'repo-snapshot') refreshCoreData(event.repoId)\n",
        },
      ]),
    ).toEqual([])
  })
})
