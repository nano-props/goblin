import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    restoredRepoId: '/repo-d',
  }

  await persistence.writeNativeClientWorkspaceState(state)

  await expect(persistence.readNativeClientWorkspaceState()).resolves.toEqual({ kind: 'loaded', state })
})

test('distinguishes a missing workspace file from read failures', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')

  await expect(persistence.readNativeClientWorkspaceState()).resolves.toEqual({ kind: 'missing' })

  writeFileSync(path.join(tmp, 'client-workspace.json'), '{invalid json', 'utf-8')
  await expect(persistence.readNativeClientWorkspaceState()).rejects.toBeInstanceOf(SyntaxError)
})
