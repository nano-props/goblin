import { describe, expect, test } from 'vitest'
import { localWorkspaceNativePath, resolveWorkspaceScopedPath } from '#/server/modules/workspace-path.ts'

describe('workspace native execution paths', () => {
  test('decodes a canonical local workspace only at the execution boundary', () => {
    const workspaceId = 'goblin+file:///repo'

    expect(localWorkspaceNativePath(workspaceId)).toBe('/repo')
    expect(resolveWorkspaceScopedPath(workspaceId, workspaceId)).toBe('/repo')
  })

  test('does not turn remote, malformed, or non-workspace targets into local paths', () => {
    expect(localWorkspaceNativePath('goblin+ssh://prod/srv/repo')).toBeNull()
    expect(localWorkspaceNativePath('/legacy/native/path')).toBeNull()
    expect(resolveWorkspaceScopedPath('goblin+file:///repo', '/repo')).toBeNull()
  })

  test('decodes an SSH workspace at its remote execution boundary', () => {
    const workspaceId = 'goblin+ssh://prod/srv/repo'
    expect(resolveWorkspaceScopedPath(workspaceId, workspaceId)).toBe('/srv/repo')
  })
})
