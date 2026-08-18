import { describe, expect, test } from 'vitest'
import type { WorkspaceRepoWorktreeSnapshot } from '#/shared/git-types.ts'
import type { WorkspaceTerminalSessionSummary } from '#/web/terminal/components/types.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { resolveWorkspacePaneTerminalDestinationLocation } from '#/web/workspace-pane/workspace-pane-terminal-destination-location.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const LINKED_ROOT = workspaceIdForTest('goblin+file:///workspace/linked')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime-dashboard-destination'

describe('resolveWorkspacePaneTerminalDestinationLocation', () => {
  test('projects a filesystem root terminal to the root location', () => {
    const destination = resolveWorkspacePaneTerminalDestinationLocation({
      workspace: filesystemWorkspace(),
      base: rootSession().base,
      snapshot: { kind: 'pending' },
    })

    expect(destination).toMatchObject({
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
    const destination = resolveWorkspacePaneTerminalDestinationLocation({
      workspace: gitWorkspace(),
      base: rootSession().base,
      snapshot: { kind: 'ready', worktrees: [source, worktree('/workspace/linked', false)] },
    })

    expect(destination).toMatchObject({
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
    const destination = resolveWorkspacePaneTerminalDestinationLocation({
      workspace: gitWorkspace(),
      base: linkedSession().base,
      snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true), linked] },
    })

    expect(destination).toMatchObject({
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
      resolveWorkspacePaneTerminalDestinationLocation({
        workspace: gitWorkspace(),
        base: rootSession().base,
        snapshot: { kind: 'pending' },
      }),
    ).toEqual({ kind: 'pending' })
  })

  test('reports an unavailable initial Git snapshot without treating it as pending', () => {
    expect(
      resolveWorkspacePaneTerminalDestinationLocation({
        workspace: gitWorkspace(),
        base: rootSession().base,
        snapshot: { kind: 'unavailable' },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects a git-worktree execution target that points at the source worktree', () => {
    const sourceTargetSession = linkedSession(WORKSPACE_ID)
    expect(
      resolveWorkspacePaneTerminalDestinationLocation({
        workspace: gitWorkspace(),
        base: sourceTargetSession.base,
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true)] },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects missing source and linked worktrees', () => {
    expect(
      resolveWorkspacePaneTerminalDestinationLocation({
        workspace: gitWorkspace(),
        base: rootSession().base,
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace/linked', false)] },
      }),
    ).toEqual({ kind: 'unavailable' })
    expect(
      resolveWorkspacePaneTerminalDestinationLocation({
        workspace: gitWorkspace(),
        base: linkedSession().base,
        snapshot: { kind: 'ready', worktrees: [worktree('/workspace', true)] },
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test('rejects a stale workspace runtime', () => {
    const workspace = gitWorkspace()
    workspace.workspaceRuntimeId = 'workspace-runtime-current'
    expect(
      resolveWorkspacePaneTerminalDestinationLocation({
        workspace,
        base: rootSession().base,
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

function rootSession(): WorkspaceTerminalSessionSummary {
  return terminalSession({
    target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
    presentation: { kind: 'workspace-root' },
  })
}

function linkedSession(root = LINKED_ROOT): WorkspaceTerminalSessionSummary {
  return terminalSession({
    target: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, root },
    presentation: { kind: 'git-worktree' },
  })
}

function terminalSession(base: WorkspaceTerminalSessionSummary['base']): WorkspaceTerminalSessionSummary {
  return {
    type: 'terminal',
    terminalFilesystemTargetKey: 'terminal-target',
    terminalSessionId: 'term-dashboard-destination',
    index: 0,
    title: 'Terminal',
    fullTitle: 'Terminal',
    processName: 'zsh',
    phase: 'open',
    selected: false,
    hasBell: false,
    hasRecentOutput: false,
    base,
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
