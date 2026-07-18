import { describe, expect, test } from 'vitest'
import { createBranchSnapshot, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import {
  createAppLevelIntentPlan,
  createExternalOpenDrainKickPlan,
  createTerminalBellIntentPlan,
  createWorkspaceIntentPlan,
} from '#/web/hooks/client-effect-intent-plans.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'

const CURRENT_GIT_REPO = {
  id: 'goblin+file:///tmp/repo',
  repoRuntimeId: 'repo-runtime-test-7',
  workspaceProbe: {
    status: 'ready' as const,
    name: 'repo',
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  },
}

const CURRENT_DIRECTORY_REPO = {
  ...CURRENT_GIT_REPO,
  workspaceProbe: {
    ...CURRENT_GIT_REPO.workspaceProbe,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: false },
      git: { status: 'unavailable' as const },
    },
  },
}

describe('client effect intent plans', () => {
  test('creates a worktree terminal bell plan when the worktree group matches a known worktree', () => {
    resetReposStore()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-main' } }),
        createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } }),
      ],
    })

    const plan = createTerminalBellIntentPlan(repo, readRepoBranchQueryProjection(repo), {
      type: 'terminal-bell-click',
      repoRoot: repo.id,
      terminalSessionId: 'term-222222222222222222222',
      terminalWorktreeKey: formatTerminalWorktreeKeyForPath('goblin+file:///tmp/repo', '/tmp/repo-feature'),
    })

    expect(plan).toEqual({
      kind: 'show-worktree-terminal',
      repoId: repo.id,
      branch: 'feature/test',
      terminalSessionId: 'term-222222222222222222222',
      terminalWorktreeKey: formatTerminalWorktreeKeyForPath('goblin+file:///tmp/repo', '/tmp/repo-feature'),
    })
  })

  test('marks worktree terminal bell intent unavailable when the branch read model is missing', () => {
    const plan = createTerminalBellIntentPlan({ id: 'goblin+file:///tmp/repo' }, null, {
      type: 'terminal-bell-click',
      repoRoot: 'goblin+file:///tmp/repo',
      terminalSessionId: 'term-222222222222222222222',
      terminalWorktreeKey: formatTerminalWorktreeKeyForPath('goblin+file:///tmp/repo', '/tmp/repo-feature'),
    })

    expect(plan).toEqual({ kind: 'unavailable', reason: 'branch-read-model-unavailable' })
  })

  test('routes a detached worktree bell through its authoritative catalog entry', () => {
    const worktreePath = '/workspace/detached'
    const plan = createTerminalBellIntentPlan(
      { id: 'goblin+file:///workspace/repo' },
      {
        branches: [],
        currentBranch: 'main',
        status: [{ path: worktreePath, isMain: false, entries: [] }],
        worktreesByPath: {
          [worktreePath]: { path: worktreePath, isMain: false, isDirty: false, changeCount: 0 },
        },
      },
      {
        type: 'terminal-bell-click',
        repoRoot: 'goblin+file:///workspace/repo',
        terminalSessionId: 'term-333333333333333333333',
        terminalWorktreeKey: formatTerminalWorktreeKeyForPath('goblin+file:///workspace/repo', worktreePath),
      },
    )

    expect(plan).toEqual({
      kind: 'show-detached-worktree-terminal',
      repoId: 'goblin+file:///workspace/repo',
      worktreePath,
      terminalSessionId: 'term-333333333333333333333',
    })
  })

  test('suppresses recent repo open when overlays block the action', () => {
    const plan = createAppLevelIntentPlan(
      { type: 'open-recent-workspace-requested', entry: { kind: 'local', id: 'goblin+file:///tmp/repo' } },
      { overlayBlocked: true },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses close repo when workspace shortcuts are blocked', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'close-workspace-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses workspace tab close shortcut while workspace shortcuts are blocked', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-pane-close-tab-or-window-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses workspace tab close shortcut while overlays block workspace actions', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-pane-close-tab-or-window-requested' },
      {
        overlayBlocked: true,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('routes workspace tab close shortcut to close-window when no repo is active', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-pane-close-tab-or-window-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: null,
        currentRepo: null,
        currentWorkspacePaneCommandTarget: null,
      },
    )

    expect(plan).toEqual({ kind: 'close-window' })
  })

  test('keeps native new-terminal intent active while workspace shortcuts are suppressed', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'terminal-new-tab-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({
      kind: 'new-terminal-tab',
      repoId: 'goblin+file:///tmp/repo',
      target: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
    })
  })

  test('rejects native terminal intent when the workspace has no terminal capability', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'terminal-new-tab-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: CURRENT_DIRECTORY_REPO.id,
        currentRepo: CURRENT_DIRECTORY_REPO,
        currentWorkspacePaneCommandTarget: {
          kind: 'workspace-root',
          workspacePaneRoute: null,
          filesystemTarget: {
            kind: 'workspace-root',
            workspaceId: CURRENT_DIRECTORY_REPO.id,
            workspaceRuntimeId: CURRENT_DIRECTORY_REPO.repoRuntimeId,
            rootPath: '/workspace/directory',
            capabilities: CURRENT_DIRECTORY_REPO.workspaceProbe.capabilities,
          },
        },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('creates a refresh plan from the current repo runtime id', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'repo-refresh-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({
      kind: 'refresh-repo',
      repoId: 'goblin+file:///tmp/repo',
      repoRuntimeId: 'repo-runtime-test-7',
    })
  })

  test('creates a zen mode toggle plan for the current workspace', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-zen-mode-toggle-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'toggle-zen-mode' })
  })

  test('suppresses zen mode toggle when workspace shortcuts are blocked', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-zen-mode-toggle-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses zen mode toggle while the terminal is focused', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-zen-mode-toggle-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: true,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('creates a create-worktree plan for the current workspace', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'create-worktree-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'create-worktree' })
  })

  test('rejects create-worktree intent for a non-Git workspace', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'create-worktree-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: CURRENT_DIRECTORY_REPO.id,
        currentRepo: CURRENT_DIRECTORY_REPO,
        currentWorkspacePaneCommandTarget: {
          kind: 'workspace-root',
          workspacePaneRoute: null,
          filesystemTarget: {
            kind: 'workspace-root',
            workspaceId: CURRENT_DIRECTORY_REPO.id,
            workspaceRuntimeId: CURRENT_DIRECTORY_REPO.repoRuntimeId,
            rootPath: '/workspace/directory',
            capabilities: CURRENT_DIRECTORY_REPO.workspaceProbe.capabilities,
          },
        },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses create-worktree when there is no current repo', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'create-worktree-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: null,
        currentRepo: null,
        currentWorkspacePaneCommandTarget: null,
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses create-worktree when workspace shortcuts are blocked', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'create-worktree-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentWorkspaceId: 'goblin+file:///tmp/repo',
        currentRepo: CURRENT_GIT_REPO,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('external open drain kick plan schedules rerun when a drain is already active', () => {
    expect(createExternalOpenDrainKickPlan({ disposed: false, draining: true })).toEqual({
      kind: 'schedule-rerun',
    })
  })
})
