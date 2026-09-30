import {
  createRepoWorktreeSnapshotForTest,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { describe, expect, test } from 'vitest'
import { createTerminalBellIntentPlan, createWorkspaceIntentPlan } from '#/web/hooks/client-effect-intent-plans.ts'
import { getRepoSnapshotQueryData, getRepoWorktreeStatusQueryData } from '#/web/repos/query-cache.ts'
import type { BranchSnapshotInfo, WorkspaceRepoWorktreeSnapshot, WorktreeStatus } from '#/shared/git-types.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspacePaneLocationForBranchTarget } from '#/web/workspace-pane/workspace-pane-location.ts'

const CURRENT_GIT_REPO = {
  id: workspaceIdForTest('goblin+file:///tmp/repo'),
  workspaceRuntimeId: 'repo-runtime-test-7',
  workspaceProbe: {
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  },
}

function repositoryFacts(
  branches: BranchSnapshotInfo[],
  status: WorktreeStatus[] | undefined,
  worktrees: WorkspaceRepoWorktreeSnapshot[] = [],
) {
  return {
    snapshot: {
      branches,
      worktrees,
      current: 'main',
      remote: {
        remotes: [],
        hasRemotes: false,
        hasBrowserRemote: false,
        remoteProviders: {},
        hasGitHubRemote: false,
      },
    },
    status,
  }
}

function repositoryFactsForTest(repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>) {
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
  return snapshot
    ? { snapshot, status: getRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId)?.status }
    : null
}
const GIT_WORKSPACE_ID = CURRENT_GIT_REPO.id
const DETACHED_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/example-repo')
const MAIN_COMMAND_TARGET = {
  location: workspacePaneLocationForBranchTarget(
    { kind: 'git-branch', workspaceId: GIT_WORKSPACE_ID, branchName: 'main' },
    CURRENT_GIT_REPO.workspaceRuntimeId,
  ),
  workspacePaneRoute: null,
}

function bellWorkspace(
  workspaceId: WorkspaceState['id'],
  workspaceRuntimeId: string,
  capability: 'filesystem' | 'git',
): WorkspaceState {
  const workspace = emptyWorkspace(workspaceId, workspaceRuntimeId)
  acceptWorkspaceProbeState(workspace, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git:
        capability === 'git'
          ? { status: 'available', worktrees: true, pullRequests: { provider: 'none' } }
          : { status: 'unavailable' },
    },
    diagnostics: [],
  })
  return workspace
}

describe('client effect intent plans', () => {
  test('creates a worktree terminal bell plan when the worktree group matches a known worktree', () => {
    resetWorkspacesStore()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main'), createBranchSnapshot('feature/test')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-main', { isPrimary: false, isLocked: false }),
        createRepoWorktreeSnapshotForTest('feature/test', '/tmp/repo-feature', { isPrimary: false, isLocked: false }),
      ],
    })

    const plan = createTerminalBellIntentPlan(repo, repositoryFactsForTest(repo), {
      type: 'terminal-bell-click',
      terminalSessionId: 'term-222222222222222222222',
      session: {
        target: {
          kind: 'git-worktree',
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: workspaceIdForTest('goblin+file:///tmp/repo-feature'),
        },
        presentation: { kind: 'git-worktree' },
      },
    })

    expect(plan).toMatchObject({
      kind: 'show-terminal',
      location: { kind: 'linked-worktree', routeTarget: { worktreePath: '/tmp/repo-feature' } },
    })
  })

  test('creates a workspace-root terminal bell plan without a Git read model', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const plan = createTerminalBellIntentPlan(
      bellWorkspace(workspaceId, 'workspace-runtime-test', 'filesystem'),
      null,
      {
        type: 'terminal-bell-click',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: 'workspace-runtime-test' },
          presentation: { kind: 'workspace-root' },
        },
      },
    )

    expect(plan).toMatchObject({ kind: 'show-terminal', location: { kind: 'workspace-root' } })
  })

  test('projects a Git source root terminal bell to its source worktree', () => {
    resetWorkspacesStore()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main')],
      worktrees: [createRepoWorktreeSnapshotForTest('main', '/tmp/repo', { isSource: true, isPrimary: true })],
    })

    const plan = createTerminalBellIntentPlan(repo, repositoryFactsForTest(repo), {
      type: 'terminal-bell-click',
      terminalSessionId: 'term-111111111111111111111',
      session: {
        target: {
          kind: 'workspace-root',
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
        },
        presentation: { kind: 'workspace-root' },
      },
    })

    expect(plan).toMatchObject({
      kind: 'show-terminal',
      location: {
        kind: 'source-worktree',
        routeTarget: { kind: 'git-worktree', worktreePath: '/tmp/repo' },
        paneTarget: { kind: 'workspace-root' },
      },
    })
  })

  test('marks worktree terminal bell intent unavailable when the branch read model is missing', () => {
    const plan = createTerminalBellIntentPlan(bellWorkspace(GIT_WORKSPACE_ID, 'workspace-runtime-test', 'git'), null, {
      type: 'terminal-bell-click',
      terminalSessionId: 'term-222222222222222222222',
      session: {
        target: {
          kind: 'git-worktree',
          workspaceId: GIT_WORKSPACE_ID,
          workspaceRuntimeId: 'workspace-runtime-test',
          root: workspaceIdForTest('goblin+file:///tmp/repo-feature'),
        },
        presentation: { kind: 'git-worktree' },
      },
    })

    expect(plan).toEqual({ kind: 'unavailable' })
  })

  test('routes a detached worktree bell through its authoritative catalog entry', () => {
    const worktreePath = '/workspace/detached'
    const plan = createTerminalBellIntentPlan(
      bellWorkspace(DETACHED_WORKSPACE_ID, 'workspace-runtime-test', 'git'),
      repositoryFacts(
        [],
        [{ path: worktreePath, isMain: false, entries: [] }],
        [
          {
            path: worktreePath,
            head: { kind: 'detached' },
            headOid: '0123456789abcdef0123456789abcdef01234567',
            operation: null,
            materializedBranch: null,
            isPrimary: false,
            isSource: false,
            isLocked: false,
          },
        ],
      ),
      {
        type: 'terminal-bell-click',
        terminalSessionId: 'term-333333333333333333333',
        session: {
          target: {
            kind: 'git-worktree',
            workspaceId: DETACHED_WORKSPACE_ID,
            workspaceRuntimeId: 'workspace-runtime-test',
            root: workspaceIdForTest('goblin+file:///workspace/detached'),
          },
          presentation: { kind: 'git-worktree' },
        },
      },
    )

    expect(plan).toMatchObject({
      kind: 'show-terminal',
      location: { kind: 'linked-worktree', routeTarget: { worktreePath } },
    })
  })

  test('keeps detached presentation authoritative when the current catalog associates the path with a branch', () => {
    const worktreePath = '/workspace/detached'
    const plan = createTerminalBellIntentPlan(
      bellWorkspace(DETACHED_WORKSPACE_ID, 'workspace-runtime-test', 'git'),
      repositoryFacts(
        [createBranchSnapshot('feature/later')],
        [{ path: worktreePath, isMain: false, entries: [] }],
        [createRepoWorktreeSnapshotForTest('feature/later', worktreePath)],
      ),
      {
        type: 'terminal-bell-click',
        terminalSessionId: 'term-444444444444444444444',
        session: {
          target: {
            kind: 'git-worktree',
            workspaceId: DETACHED_WORKSPACE_ID,
            workspaceRuntimeId: 'workspace-runtime-test',
            root: workspaceIdForTest('goblin+file:///workspace/detached'),
          },
          presentation: { kind: 'git-worktree' },
        },
      },
    )

    expect(plan).toMatchObject({
      kind: 'show-terminal',
      location: { kind: 'linked-worktree', routeTarget: { worktreePath } },
    })
  })

  test('rejects bell identities from a stale Workspace runtime', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const plan = createTerminalBellIntentPlan(
      bellWorkspace(workspaceId, 'workspace-runtime-current', 'filesystem'),
      null,
      {
        type: 'terminal-bell-click',
        terminalSessionId: 'term-555555555555555555555',
        session: {
          target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: 'workspace-runtime-stale' },
          presentation: { kind: 'workspace-root' },
        },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('rejects a branch presentation whose worktree no longer matches the execution target', () => {
    resetWorkspacesStore()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('feature/test')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/test', '/tmp/repo-feature', { isPrimary: false, isLocked: false }),
      ],
    })
    const otherPath = '/tmp/repo-other'
    const plan = createTerminalBellIntentPlan(
      repo,
      repositoryFacts(
        [createBranchSnapshot('feature/test')],
        [{ path: otherPath, isMain: false, entries: [] }],
        [createRepoWorktreeSnapshotForTest('feature/test', '/tmp/repo-feature')],
      ),
      {
        type: 'terminal-bell-click',
        terminalSessionId: 'term-666666666666666666666',
        session: {
          target: {
            kind: 'git-worktree',
            workspaceId: repo.id,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            root: workspaceIdForTest('goblin+file:///tmp/repo-other'),
          },
          presentation: { kind: 'git-worktree' },
        },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test.each([
    {
      overlayBlocked: true,
      workspaceShortcutSuppressed: false,
      currentWorkspaceId: GIT_WORKSPACE_ID,
      currentWorkspacePaneCommandTarget: MAIN_COMMAND_TARGET,
    },
    {
      overlayBlocked: false,
      workspaceShortcutSuppressed: true,
      currentWorkspaceId: GIT_WORKSPACE_ID,
      currentWorkspacePaneCommandTarget: MAIN_COMMAND_TARGET,
    },
    {
      overlayBlocked: false,
      workspaceShortcutSuppressed: false,
      currentWorkspaceId: null,
      currentWorkspacePaneCommandTarget: MAIN_COMMAND_TARGET,
    },
    {
      overlayBlocked: false,
      workspaceShortcutSuppressed: false,
      currentWorkspaceId: GIT_WORKSPACE_ID,
      currentWorkspacePaneCommandTarget: null,
    },
  ])('suppresses view commands without an available workspace route', (context) => {
    expect(createWorkspaceIntentPlan({ type: 'show-workspace-pane-tab-requested', tab: 'history' }, context)).toEqual({
      kind: 'noop',
    })
  })

  test('preserves the current route target for a view command', () => {
    expect(
      createWorkspaceIntentPlan(
        { type: 'show-workspace-pane-tab-requested', tab: 'history' },
        {
          overlayBlocked: false,
          workspaceShortcutSuppressed: false,
          currentWorkspaceId: GIT_WORKSPACE_ID,
          currentWorkspacePaneCommandTarget: MAIN_COMMAND_TARGET,
        },
      ),
    ).toEqual({
      kind: 'show-workspace-pane-tab',
      workspaceId: GIT_WORKSPACE_ID,
      target: MAIN_COMMAND_TARGET,
      tab: 'history',
    })
  })
})
