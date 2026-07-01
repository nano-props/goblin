import { describe, expect, test } from 'vitest'
import { createBranchSnapshot, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import {
  createAppLevelIntentPlan,
  createExternalOpenDrainKickPlan,
  createTerminalBellIntentPlan,
  createWorkspaceIntentPlan,
} from '#/web/hooks/client-effect-intent-plans.ts'

describe('client effect intent plans', () => {
  test('creates a worktree terminal bell plan when the worktree group matches a known worktree', () => {
    resetReposStore()
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-main' } }),
        createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } }),
      ],
    })

    const plan = createTerminalBellIntentPlan(repo, {
      type: 'terminal-bell-click',
      repoRoot: repo.id,
      terminalSessionId: 'session-2',
      terminalWorktreeKey: '/tmp/repo\0/tmp/repo-feature',
    })

    expect(plan).toEqual({
      kind: 'show-worktree-terminal',
      repoId: repo.id,
      branch: 'feature/test',
      terminalSessionId: 'session-2',
      terminalWorktreeKey: '/tmp/repo\0/tmp/repo-feature',
    })
  })

  test('suppresses recent repo open when overlays block the action', () => {
    const plan = createAppLevelIntentPlan(
      { type: 'open-recent-repo-requested', entry: { kind: 'local', id: '/tmp/repo' } },
      { overlayBlocked: true },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('suppresses close repo when workspace shortcuts are blocked', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'close-repo-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
      },
    )

    expect(plan).toEqual({ kind: 'noop' })
  })

  test('routes workspace tab close shortcut to close-window while workspace shortcuts are blocked', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-pane-close-tab-or-window-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
      },
    )

    expect(plan).toEqual({ kind: 'close-window' })
  })

  test('routes workspace tab close shortcut to close-window while overlays block workspace actions', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-pane-close-tab-or-window-requested' },
      {
        overlayBlocked: true,
        workspaceShortcutSuppressed: true,
        terminalFocused: false,
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
      },
    )

    expect(plan).toEqual({ kind: 'close-window' })
  })

  test('creates a refresh plan from the current visible repo token', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'repo-refresh-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
      },
    )

    expect(plan).toEqual({ kind: 'refresh-repo', repoId: '/tmp/repo', token: 7 })
  })

  test('creates a zen mode toggle plan for the current workspace', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'workspace-zen-mode-toggle-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
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
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
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
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
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
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
      },
    )

    expect(plan).toEqual({ kind: 'create-worktree' })
  })

  test('suppresses create-worktree when there is no current repo', () => {
    const plan = createWorkspaceIntentPlan(
      { type: 'create-worktree-requested' },
      {
        overlayBlocked: false,
        workspaceShortcutSuppressed: false,
        terminalFocused: false,
        currentRepoId: null,
        currentRepo: null,
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
        currentRepoId: '/tmp/repo',
        currentRepo: { id: '/tmp/repo', instanceToken: 7 },
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
