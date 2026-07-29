// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { checkArchitectureSources } from '#scripts/check-boundaries.ts'

describe('architecture boundary rules', () => {
  test('rejects namespace re-exports from disallowed modules', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/server/desktop.ts',
          source: "export * as desktop from 'electron'\n",
        },
      ]),
    ).toEqual([expect.stringContaining('/src/server/desktop.ts: disallowed import "electron"')])
  })

  test('rejects dynamic imports and require calls inside template interpolations', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/server/desktop.ts',
          source: "const label = `桌面: ${require('electron')}`\n",
        },
        {
          relativeFilePath: '/src/web/desktop.ts',
          source: "const label = `desktop: ${await import('#/main/desktop.ts')}`\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining('/src/server/desktop.ts: disallowed import "electron"'),
      expect.stringContaining('/src/web/desktop.ts: disallowed import "#/main/desktop.ts"'),
    ])
  })

  test('rejects require and dynamic import calls with whitespace before the parenthesis', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/server/desktop.ts',
          source: "const desktop = require ('electron')\n",
        },
        {
          relativeFilePath: '/src/web/desktop.ts',
          source: "const desktop = import ('#/main/desktop.ts')\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining('/src/server/desktop.ts: disallowed import "electron"'),
      expect.stringContaining('/src/web/desktop.ts: disallowed import "#/main/desktop.ts"'),
    ])
  })

  test('rejects disallowed imports when comments appear in import syntax', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/server/desktop.ts',
          source: "import electron from /* comment */ 'electron'\n",
        },
        {
          relativeFilePath: '/src/server/reexport.ts',
          source: "export * from /* comment */ 'electron'\n",
        },
        {
          relativeFilePath: '/src/server/require.ts',
          source: "const desktop = require(/* comment */ 'electron')\n",
        },
        {
          relativeFilePath: '/src/web/desktop.ts',
          source: "const desktop = import(/* @vite-ignore */ '#/main/desktop.ts')\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining('/src/server/desktop.ts: disallowed import "electron"'),
      expect.stringContaining('/src/server/reexport.ts: disallowed import "electron"'),
      expect.stringContaining('/src/server/require.ts: disallowed import "electron"'),
      expect.stringContaining('/src/web/desktop.ts: disallowed import "#/main/desktop.ts"'),
    ])
  })

  test('rejects disallowed settings-client symbols when named bindings contain comments', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/settings-queries.ts',
          source: "import { setThemePref /* comment */ } from '#/web/settings-client.ts'\n",
        },
        {
          relativeFilePath: '/src/web/settings-queries.ts',
          source: "import { setThemePref /* comment */ as getSettingsSnapshot } from '#/web/settings-client.ts'\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining('/src/web/settings-queries.ts: disallowed import "#/web/settings-client.ts"'),
      expect.stringContaining('/src/web/settings-queries.ts: disallowed import "#/web/settings-client.ts"'),
    ])
  })

  test('ignores import-like text inside regex literals', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/server/desktop.ts',
          source: "const importText = /require('electron')/\n",
        },
        {
          relativeFilePath: '/src/web/desktop.ts',
          source: "const importText = /import\\('#\\/main\\/desktop\\.ts'\\)/\n",
        },
        {
          relativeFilePath: '/src/server/desktop.ts',
          source: "if (ok) /require('electron')/.test(text)\n",
        },
      ]),
    ).toEqual([])
  })

  test('rejects named re-exports when comments contain braces', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/server/reexport.ts',
          source: "export { app /* } */ } from 'electron'\n",
        },
      ]),
    ).toEqual([expect.stringContaining('/src/server/reexport.ts: disallowed import "electron"')])
  })

  test('keeps static import bindings after import expressions and import.meta', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/settings-queries.ts',
          source:
            "const lazy = import('safe-module')\nconst url = import.meta.url\nimport { getSettingsSnapshot } from '#/web/settings-client.ts'\n",
        },
      ]),
    ).toEqual([])
  })

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
          source: "await postServerJson('/api/repo/projection', { cwd })\n",
        },
        {
          relativeFilePath: '/src/web/repo-client.ts',
          source: 'await getRepoProjection(cwd)\n',
        },
        {
          relativeFilePath: '/src/web/repo-client.ts',
          source: 'const schema = REPO_PROCEDURE_SCHEMAS.status\n',
        },
        {
          relativeFilePath: '/src/web/repo-branch-read-model.ts',
          source: 'repoBranchReadModelFromSnapshot(projection.snapshot, projection.status)\n',
        },
        {
          relativeFilePath: '/src/web/stores/workspaces/refresh.ts',
          source: 'repo.dataLoads.visibleStatus.error = message\n',
        },
        {
          relativeFilePath: '/src/shared/repo-events.ts',
          source:
            "const event: RepoQueryInvalidationEvent = { type: 'repo-query-invalidated', repoId, query: 'repo-snapshot' }\n",
        },
      ]),
    ).toEqual([
      expect.stringContaining('legacy repo IPC read route'),
      expect.stringContaining('legacy repo HTTP read route'),
      expect.stringContaining('legacy repo read helper'),
      expect.stringContaining('legacy repo procedure schema key'),
      expect.stringContaining('projection-owned worktree status'),
      expect.stringContaining('store-owned worktree status lifecycle'),
      expect.stringContaining('legacy repo query invalidation event'),
      expect.stringContaining('legacy query-shaped repo invalidation field'),
    ])
  })

  test('allows independent status composition and domain invalidation names in web code', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/repo-branch-read-model.ts',
          source: 'repoBranchReadModelFromSnapshot(projection.snapshot, statusSnapshot.status)\n',
        },
        {
          relativeFilePath: '/src/web/hooks/useRepoStoreInvalidationRefresh.ts',
          source: "if (event.domain === 'metadata') invalidateRepoMetadataQueries(event.repoId)\n",
        },
      ]),
    ).toEqual([])
  })

  test('rejects transitive Node imports from the browser runtime', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/main.tsx',
          source: "import { validate } from '#/shared/validator.ts'\nvalidate()\n",
        },
        {
          relativeFilePath: '/src/shared/validator.ts',
          source: "import path from 'node:path'\nexport const validate = path.isAbsolute\n",
        },
      ]),
    ).toEqual([expect.stringContaining('/src/web/main.tsx -> /src/shared/validator.ts -> node:path')])
  })

  test('rejects bare Node builtin imports from the browser runtime', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/main.tsx',
          source: "import path from 'path'\npath.resolve('.')\n",
        },
      ]),
    ).toEqual([expect.stringContaining('/src/web/main.tsx -> path')])
  })

  test('allows type-only and browser-unreachable Node imports', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/main.tsx',
          source: "import type { NativeValue } from '#/shared/native.ts'\nexport type Value = NativeValue\n",
        },
        {
          relativeFilePath: '/src/shared/native.ts',
          source:
            "import path from 'node:path'\nexport type NativeValue = string\nexport const resolve = path.resolve\n",
        },
      ]),
    ).toEqual([])
  })

  test('allows inline type-only imports and re-exports', () => {
    expect(
      checkArchitectureSources([
        {
          relativeFilePath: '/src/web/main.tsx',
          source:
            "import { type NativeValue } from '#/shared/native.ts'\nexport { type OtherValue } from '#/shared/other.ts'\nexport type * from '#/shared/types.ts'\nexport type Value = NativeValue\n",
        },
        {
          relativeFilePath: '/src/shared/native.ts',
          source:
            "import path from 'node:path'\nexport type NativeValue = string\nexport const resolve = path.resolve\n",
        },
        {
          relativeFilePath: '/src/shared/other.ts',
          source: "import os from 'node:os'\nexport type OtherValue = string\nexport const platform = os.platform\n",
        },
        {
          relativeFilePath: '/src/shared/types.ts',
          source: "import fs from 'node:fs'\nexport type FileValue = string\nexport const read = fs.readFile\n",
        },
      ]),
    ).toEqual([])
  })
})
