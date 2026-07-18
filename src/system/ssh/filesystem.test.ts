import { describe, expect, test, vi } from 'vitest'
import { getRemoteDirectoryWalk } from '#/system/ssh/filesystem.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const target: RemoteRepoTarget = {
  id: workspaceIdForTest('goblin+ssh://mock-host/workspace'),
  alias: 'mock-host',
  remotePath: '/workspace',
  displayName: 'mock-host:workspace',
  host: 'mock.example',
  user: 'mock-user',
  port: 22,
}

describe('remote filesystem reads', () => {
  test('reads an authorized root without performing Git membership discovery', async () => {
    const run = vi.fn(async () => ({ ok: true as const, stdout: 'README.md\0src/', stderr: '', code: 0 }))

    await expect(getRemoteDirectoryWalk(target, '/workspace', { prefix: 'src', run })).resolves.toEqual({
      ok: true,
      message: 'README.md\0src/',
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'directoryChildren', path: '/workspace', prefix: 'src' },
      target,
      { signal: undefined },
    )
  })

  test('preserves a missing or unreadable directory failure', async () => {
    const run = vi.fn(async () => ({
      ok: false as const,
      stdout: '',
      stderr: 'error.workspace-path-not-found',
      message: 'error.workspace-path-not-found',
    }))

    await expect(getRemoteDirectoryWalk(target, '/workspace/missing', { run })).resolves.toEqual({
      ok: false,
      message: 'error.workspace-path-not-found',
    })
  })
})
