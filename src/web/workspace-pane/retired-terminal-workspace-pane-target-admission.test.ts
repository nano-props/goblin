import { describe, expect, test } from 'vitest'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { resolveRetiredTerminalWorkspacePaneTargetAdmission } from '#/web/workspace-pane/retired-terminal-workspace-pane-target-admission.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/project')
const ROOT_ROUTE_TARGET = { kind: 'workspace-root', workspaceId: WORKSPACE_ID } satisfies WorkspacePaneTabsTarget

function rootCommandTarget(workspaceRuntimeId: string): WorkspacePaneCommandTarget {
  return {
    routeTarget: ROOT_ROUTE_TARGET,
    workspacePaneRoute: null,
    filesystemTarget: workspaceRootPaneFilesystemTarget({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId,
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
    }),
  }
}

describe('resolveRetiredTerminalWorkspacePaneTargetAdmission', () => {
  test('keeps admission pending while the workspace capability is unresolved', () => {
    expect(
      resolveRetiredTerminalWorkspacePaneTargetAdmission({
        routeTarget: ROOT_ROUTE_TARGET,
        workspaceRuntimeId: 'runtime-1',
        capabilityKind: 'probing',
        branchReadModelStatus: 'pending',
        worktreeReadModelStatus: 'pending',
        target: null,
      }),
    ).toEqual({ kind: 'pending', workspaceRuntimeId: 'runtime-1' })
  })

  test('admits a ready workspace-root target without waiting for disabled repo queries', () => {
    const target = rootCommandTarget('runtime-1')
    expect(
      resolveRetiredTerminalWorkspacePaneTargetAdmission({
        routeTarget: ROOT_ROUTE_TARGET,
        workspaceRuntimeId: 'runtime-1',
        capabilityKind: 'filesystem',
        branchReadModelStatus: 'pending',
        worktreeReadModelStatus: 'pending',
        target,
      }),
    ).toEqual({ kind: 'ready', workspaceRuntimeId: 'runtime-1', target })
  })

  test('keeps a branch target pending until both authoritative repo read models resolve', () => {
    expect(
      resolveRetiredTerminalWorkspacePaneTargetAdmission({
        routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'feature' },
        workspaceRuntimeId: 'runtime-1',
        capabilityKind: 'git',
        branchReadModelStatus: 'success',
        worktreeReadModelStatus: 'pending',
        target: null,
      }),
    ).toEqual({ kind: 'pending', workspaceRuntimeId: 'runtime-1' })
  })

  test('rejects a definitively unresolved target after its required read models settle', () => {
    expect(
      resolveRetiredTerminalWorkspacePaneTargetAdmission({
        routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'feature' },
        workspaceRuntimeId: 'runtime-1',
        capabilityKind: 'git',
        branchReadModelStatus: 'success',
        worktreeReadModelStatus: 'success',
        target: null,
      }),
    ).toEqual({ kind: 'unavailable', workspaceRuntimeId: 'runtime-1' })
  })

  test('rejects an unavailable capability instead of retaining an unfulfillable plan', () => {
    expect(
      resolveRetiredTerminalWorkspacePaneTargetAdmission({
        routeTarget: ROOT_ROUTE_TARGET,
        workspaceRuntimeId: 'runtime-1',
        capabilityKind: 'unavailable',
        branchReadModelStatus: 'pending',
        worktreeReadModelStatus: 'pending',
        target: null,
      }),
    ).toEqual({ kind: 'unavailable', workspaceRuntimeId: 'runtime-1' })
  })
})
