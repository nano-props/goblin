import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  vi.resetModules()
  vi.doUnmock('electron')
})

test('persists client workspace independently of the embedded server origin', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')
  const state = {
    ...defaultClientWorkspaceState(),
    openRepoEntries: ['/repo-a', '/repo-b', '/repo-c', '/repo-d'].map((id) => ({
      kind: 'local' as const,
      id,
    })),
    restoredRepoId: '/repo-d',
  }

  await persistence.writeNativeClientWorkspaceState(state)

  await expect(persistence.readNativeClientWorkspaceState()).resolves.toEqual(state)
})
