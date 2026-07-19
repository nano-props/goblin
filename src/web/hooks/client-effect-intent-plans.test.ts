import { describe, expect, test } from 'vitest'
import { createBranchSnapshot, resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import {
  createAppLevelIntentPlan,
  createExternalOpenDrainKickPlan,
  createTerminalBellIntentPlan,
  createWorkspaceIntentPlan,
} from '#/web/hooks/client-effect-intent-plans.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

const CURRENT_GIT_REPO = {
  id: workspaceIdForTest('goblin+file:///tmp/repo'),
  workspaceRuntimeId: 'repo-runtime-test-7',
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
const GIT_WORKSPACE_ID = CURRENT_GIT_REPO.id
const DETACHED_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/example-repo')

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
    resetWorkspacesStore()
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
      terminalSessionId: 'term-222222222222222222222',
      session: {
        target: {
          kind: 'git-worktree',
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: workspaceIdForTest('goblin+file:///tmp/repo-feature'),
        },
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/test' } },
      },
    })

    expect(plan).toEqual({
      kind: 'show-worktree-terminal',
      workspaceId: repo.id,
      branch: 'feature/test',
      terminalSessionId: 'term-222222222222222222222',
      terminalWorktreeKey: formatTerminalWorktreeKeyForPath(GIT_WORKSPACE_ID, '/tmp/repo-feature'),
    })
  })

  test('creates a workspace-root terminal bell plan without a Git read model', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const plan = createTerminalBellIntentPlan({ id: workspaceId, workspaceRuntimeId: 'workspace-runtime-test' }, null, {
      type: 'terminal-bell-click',
      terminalSessionId: 'term-111111111111111111111',
      session: {
        target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: 'workspace-runtime-test' },
        presentation: { kind: 'workspace-root' },
      },
    })

    expect(plan).toEqual({
      kind: 'show-workspace-root-terminal',
      workspaceId,
      terminalSessionId: 'term-111111111111111111111',
    })
  })

  test('keeps a Git main-worktree bell on its branch presentation', () => {
    resetWorkspacesStore()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo' } })],
    })

    const plan = createTerminalBellIntentPlan(repo, readRepoBranchQueryProjection(repo), {
      type: 'terminal-bell-click',
      terminalSessionId: 'term-111111111111111111111',
      session: {
        target: {
          kind: 'git-worktree',
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: repo.id,
        },
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
      },
    })

    expect(plan).toMatchObject({
      kind: 'show-worktree-terminal',
      workspaceId: repo.id,
      branch: 'main',
    })
  })

  test('marks worktree terminal bell intent unavailable when the branch read model is missing', () => {
    const plan = createTerminalBellIntentPlan(
      { id: workspaceIdForTest('goblin+file:///tmp/repo'), workspaceRuntimeId: 'workspace-runtime-test' },
      null,
      {
        type: 'terminal-bell-click',
        terminalSessionId: 'term-222222222222222222222',
        session: {
          target: {
            kind: 'git-worktree',
            workspaceId: GIT_WORKSPACE_ID,
            workspaceRuntimeId: 'workspace-runtime-test',
            root: workspaceIdForTest('goblin+file:///tmp/repo-feature'),
          },
          presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/test' } },
        },
      },
    )

    expect(plan).toEqual({ kind: 'unavailable', reason: 'branch-read-model-unavailable' })
  })

  test('routes a detached worktree bell through its authoritative catalog entry', () => {
    const worktreePath = '/workspace/detached'
    const plan = createTerminalBellIntentPlan(
      { id: DETACHED_WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-test' },
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
        terminalSessionId: 'term-333333333333333333333',
        session: {
          target: {
            kind: 'git-worktree',
            workspaceId: DETACHED_WORKSPACE_ID,
            workspaceRuntimeId: 'workspace-runtime-test',
            root: workspaceIdForTest('goblin+file:///workspace/detached'),
          },
          presentation: { kind: 'git-worktree', head: { kind: 'detached' } },
        },
      },
    )

    expect(plan).toEqual({
      kind: 'show-detached-worktree-terminal',
      workspaceId: DETACHED_WORKSPACE_ID,
      worktreePath,
      terminalSessionId: 'term-333333333333333333333',
    })
  })

  test('keeps detached presentation authoritative when the current catalog associates the path with a branch', () => {
    const worktreePath = '/workspace/detached'
    const plan = createTerminalBellIntentPlan(
      { id: DETACHED_WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-test' },
      {
        branches: [createBranchSnapshot('feature/later', { worktree: { path: worktreePath } })],
        currentBranch: 'main',
        status: [{ path: worktreePath, isMain: false, entries: [] }],
        worktreesByPath: {
          [worktreePath]: { path: worktreePath, isMain: false, isDirty: false, changeCount: 0 },
        },
      },
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
          presentation: { kind: 'git-worktree', head: { kind: 'detached' } },
        },
      },
    )

    expect(plan).toMatchObject({ kind: 'show-detached-worktree-terminal', worktreePath })
  })

  test('rejects bell identities from a stale Workspace runtime', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const plan = createTerminalBellIntentPlan(
      { id: workspaceId, workspaceRuntimeId: 'workspace-runtime-current' },
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
      branchSnapshots: [createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } })],
    })
    const otherPath = '/tmp/repo-other'
    const plan = createTerminalBellIntentPlan(
      repo,
      {
        branches: [createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } })],
        currentBranch: 'main',
        status: [{ path: otherPath, isMain: false, entries: [] }],
        worktreesByPath: {
          [otherPath]: { path: otherPath, isMain: false, isDirty: false, changeCount: 0 },
        },
      },
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
          presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/test' } },
        },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses recent repo open when overlays block the action', () => {
    const plan = createAppLevelIntentPlan(
      {
        type: 'open-recent-workspace-requested',
        entry: { kind: 'local', id: workspaceIdForTest('goblin+file:///tmp/repo') },
      },
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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

        currentWorkspaceRuntimeId: null,
        currentWorkspaceCapability: null,
        currentWorkspaceCanExecute: true,
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({
      kind: 'new-terminal-tab',
      workspaceId: 'goblin+file:///tmp/repo',
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

        currentWorkspaceRuntimeId: CURRENT_DIRECTORY_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'filesystem', probe: CURRENT_DIRECTORY_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
        currentWorkspacePaneCommandTarget: {
          kind: 'workspace-root',
          workspacePaneRoute: null,
          filesystemTarget: workspaceRootPaneFilesystemTarget({
            workspaceId: CURRENT_DIRECTORY_REPO.id,
            workspaceRuntimeId: CURRENT_DIRECTORY_REPO.workspaceRuntimeId,
            capabilities: CURRENT_DIRECTORY_REPO.workspaceProbe.capabilities,
          }),
        },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('rejects terminal creation before workspace operation admission is ready', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'terminal-new-tab-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: CURRENT_GIT_REPO.id,
        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: false,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('creates a refresh plan from the current workspace runtime id', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-refresh-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
        currentWorkspacePaneCommandTarget: { kind: 'git-branch', branchName: 'main', workspacePaneRoute: null },
      },
    )

    expect(plan).toEqual({
      kind: 'refresh-workspace',
      workspaceId: 'goblin+file:///tmp/repo',
      workspaceRuntimeId: 'repo-runtime-test-7',
    })
  })

  test('creates a refresh plan for a plain Workspace', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-refresh-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: CURRENT_DIRECTORY_REPO.id,
        currentWorkspaceRuntimeId: CURRENT_DIRECTORY_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'filesystem', probe: CURRENT_DIRECTORY_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
        currentWorkspacePaneCommandTarget: null,
      },
    )

    expect(plan).toEqual({
      kind: 'refresh-workspace',
      workspaceId: CURRENT_DIRECTORY_REPO.id,
      workspaceRuntimeId: CURRENT_DIRECTORY_REPO.workspaceRuntimeId,
    })
  })

  test('creates a zen mode toggle plan for the current workspace', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-zen-mode-toggle-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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

        currentWorkspaceRuntimeId: CURRENT_DIRECTORY_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'filesystem', probe: CURRENT_DIRECTORY_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
        currentWorkspacePaneCommandTarget: {
          kind: 'workspace-root',
          workspacePaneRoute: null,
          filesystemTarget: workspaceRootPaneFilesystemTarget({
            workspaceId: CURRENT_DIRECTORY_REPO.id,
            workspaceRuntimeId: CURRENT_DIRECTORY_REPO.workspaceRuntimeId,
            capabilities: CURRENT_DIRECTORY_REPO.workspaceProbe.capabilities,
          }),
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

        currentWorkspaceRuntimeId: null,
        currentWorkspaceCapability: null,
        currentWorkspaceCanExecute: true,
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
        currentWorkspaceId: CURRENT_GIT_REPO.id,

        currentWorkspaceRuntimeId: CURRENT_GIT_REPO.workspaceRuntimeId,
        currentWorkspaceCapability: { kind: 'git', probe: CURRENT_GIT_REPO.workspaceProbe },
        currentWorkspaceCanExecute: true,
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
