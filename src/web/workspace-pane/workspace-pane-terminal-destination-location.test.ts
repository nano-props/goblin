import { describe, expect, test } from 'vitest'
import type { WorkspaceRepoWorktreeSnapshot } from '#/shared/git-types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { resolveWorkspacePaneTerminalDestination } from '#/web/workspace-pane/workspace-pane-terminal-destination-location.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const LINKED_ROOT = workspaceIdForTest('goblin+file:///workspace/linked')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime-dashboard-destination'

describe('resolveWorkspacePaneTerminalDestination', () => {
  test('projects a filesystem root terminal to the root location', () => {
    const resolution = resolveWorkspacePaneTerminalDestination({
      workspace: filesystemWorkspace(),
      base: rootBase(),
      snapshot: { kind: 'pending' },
    })

    expect(resolution).toMatchObject({
      kind: 'ready',
      location: {
        kind: 'workspace-root',
        routeTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        paneTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
      },
      worktree: null,
    })
  })

  test('projects a Git root terminal to the authoritative source worktree location', () => {
    const source = worktree('/workspace', true)
    const resolution = resolveWorkspacePaneTerminalDestination({
      workspace: gitWorkspace(),
      base: rootBase(),
      snapshot: { kind: 'ready', worktrees: [source, worktree('/workspace/linked', false)] },
    })

    expect(resolution).toMatchObject({
      kind: 'ready',
      location: {
        kind: 'source-worktree',
        routeTarget: { kind: 'git-worktree', worktreePath: '/workspace' },
        paneTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
      },
      worktree: source,
    })
  })

  test('projects a linked terminal to its authoritative worktree location', () => {
    const linked = worktree('/workspace/linked', false)
    const resolution = resolveWorkspacePaneTerminalDestination({
      workspace: gitWorkspace(),
      base: linkedBase(),
      snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true), linked] },
    })

    expect(resolution).toMatchObject({
      kind: 'ready',
      location: {
        kind: 'linked-worktree',
        routeTarget: { kind: 'git-worktree', worktreePath: '/workspace/linked' },
        paneTarget: { kind: 'git-worktree', worktreePath: '/workspace/linked' },
      },
      worktree: linked,
    })
  })

  test('waits for the Git snapshot before resolving a destination', () => {
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: gitWorkspace(),
        base: rootBase(),
        snapshot: { kind: 'pending' },
      }),
    ).toEqual({ kind: 'pending' })
  })

  test('reports an unavailable initial Git snapshot without treating it as pending', () => {
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: gitWorkspace(),
        base: rootBase(),
        snapshot: { kind: 'unavailable' },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('waits while workspace capability is probing', () => {
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: emptyWorkspace(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
        base: rootBase(),
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true)] },
      }),
    ).toEqual({ kind: 'pending' })
  })

  test('reports unavailable workspace capability without consulting the snapshot', () => {
    const workspace = emptyWorkspace(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    acceptWorkspaceProbeState(workspace, { status: 'unavailable', reason: 'error.workspace-transport-unavailable' })
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace,
        base: rootBase(),
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true)] },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects a Git worktree execution target in a filesystem workspace', () => {
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: filesystemWorkspace(),
        base: linkedBase(),
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace/linked', false)] },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects a git-worktree execution target that points at the source worktree', () => {
    const sourceTargetBase = linkedBase(WORKSPACE_ID)
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: gitWorkspace(),
        base: sourceTargetBase,
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true)] },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects missing source and linked worktrees', () => {
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: gitWorkspace(),
        base: rootBase(),
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace/linked', false)] },
      }),
    ).toEqual({ kind: 'unavailable' })
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: gitWorkspace(),
        base: linkedBase(),
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true)] },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects an ambiguous source worktree catalog', () => {
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace: gitWorkspace(),
        base: rootBase(),
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true), worktree('/workspace/other', true)] },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects a stale workspace runtime', () => {
    const workspace = gitWorkspace()
    workspace.workspaceRuntimeId = 'workspace-runtime-current'
    expect(
      resolveWorkspacePaneTerminalDestination({
        workspace,
        base: rootBase(),
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true)] },
      }),
    ).toEqual({ kind: 'stale' })
  })
})

function filesystemWorkspace(): WorkspaceState {
  const workspace = emptyWorkspace(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
  acceptWorkspaceProbeState(workspace, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' },
    },
    diagnostics: [],
  })
  return workspace
}

function gitWorkspace(): WorkspaceState {
  const workspace = emptyWorkspace(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
  acceptWorkspaceProbeState(workspace, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  })
  return workspace
}

function rootBase(): TerminalSessionBase {
  return {
    target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
    presentation: { kind: 'workspace-root' },
  }
}

function linkedBase(root = LINKED_ROOT): TerminalSessionBase {
  return {
    target: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, root },
    presentation: { kind: 'git-worktree' },
  }
}

function worktree(path: string, isSource: boolean): WorkspaceRepoWorktreeSnapshot {
  return {
    path,
    head: { kind: 'branch', branchName: isSource ? 'main' : 'feature/linked' },
    headOid: '1234567890abcdef1234567890abcdef12345678',
    operation: null,
    materializedBranch: isSource ? 'main' : 'feature/linked',
    isSource,
    isPrimary: isSource,
    isLocked: false,
  }
}
