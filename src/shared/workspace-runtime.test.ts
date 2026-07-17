import { describe, expect, it } from 'vitest'
import { bindWorkspacePaneTarget, capabilitiesFromGitProbe } from '#/shared/workspace-runtime.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'

describe('workspace runtime domain', () => {
  it('keeps a readable directory ready when Git is unavailable', () => {
    expect(
      capabilitiesFromGitProbe(
        { status: 'inconclusive', diagnostic: 'git executable unavailable' },
        {
          write: true,
          terminal: true,
        },
      ),
    ).toEqual({
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' },
    })
  })

  it('binds persisted targets to the current runtime without duplicating identity in persistence', () => {
    const workspaceId = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/workspace' }, 'posix')!
    expect(bindWorkspacePaneTarget({ kind: 'workspace' }, workspaceId, 'runtime-current')).toEqual({
      kind: 'workspace',
      workspaceId,
      workspaceRuntimeId: 'runtime-current',
    })
    expect(
      bindWorkspacePaneTarget({ kind: 'git-branch', branch: 'feature/example' }, workspaceId, 'runtime-current'),
    ).toEqual({
      kind: 'git-branch',
      workspaceId,
      workspaceRuntimeId: 'runtime-current',
      branch: 'feature/example',
    })
  })
})
