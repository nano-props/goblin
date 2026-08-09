import { describe, expect, it } from 'vitest'
import {
  bindWorkspacePaneTarget,
  capabilitiesFromGitProbe,
  workspacePaneFilesystemExecutionTargetKey,
} from '#/shared/workspace-runtime.ts'
import { formatWorkspaceLocator, workspaceLocatorForPath } from '#/shared/workspace-locator.ts'

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
    expect(bindWorkspacePaneTarget({ kind: 'workspace-root' }, workspaceId, 'runtime-current')).toEqual({
      kind: 'workspace-root',
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

  it('includes every filesystem owner identity field in its stable key', () => {
    const workspaceId = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/workspace' }, 'posix')!
    const current = { kind: 'workspace-root', workspaceId, workspaceRuntimeId: 'runtime-current' } as const
    const same = { ...current }
    const nextRuntime = { ...current, workspaceRuntimeId: 'runtime-next' }
    const mainRoot = workspaceLocatorForPath(workspaceId, '/workspace/main')
    const featureRoot = workspaceLocatorForPath(workspaceId, '/workspace/feature')
    if (!mainRoot || !featureRoot) throw new Error('expected canonical worktree locators')
    const mainWorktree = {
      kind: 'git-worktree',
      workspaceId,
      workspaceRuntimeId: 'runtime-current',
      root: mainRoot,
    } as const
    const featureWorktree = { ...mainWorktree, root: featureRoot }

    expect(workspacePaneFilesystemExecutionTargetKey(current)).toBe(workspacePaneFilesystemExecutionTargetKey(same))
    expect(workspacePaneFilesystemExecutionTargetKey(current)).not.toBe(
      workspacePaneFilesystemExecutionTargetKey(nextRuntime),
    )
    expect(workspacePaneFilesystemExecutionTargetKey(mainWorktree)).toBe(
      workspacePaneFilesystemExecutionTargetKey({ ...mainWorktree }),
    )
    expect(workspacePaneFilesystemExecutionTargetKey(mainWorktree)).not.toBe(
      workspacePaneFilesystemExecutionTargetKey(featureWorktree),
    )
  })
})
