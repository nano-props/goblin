import { describe, expect, test } from 'vitest'
import { createBranchSnapshot, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import {
  createAppLevelIntentPlan,
  createExternalOpenDrainKickPlan,
  createTerminalBellIntentPlan,
  createWorkspaceIntentPlan,
} from '#/web/hooks/renderer-effect-intent-plans.ts'

describe('renderer effect intent plans', () => {
  test('creates a worktree terminal bell plan when the bell key matches a known worktree', () => {
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
      key: '/tmp/repo\0/tmp/repo-feature\0terminal-2',
    })

    expect(plan).toEqual({
      kind: 'show-worktree-terminal',
      repoId: repo.id,
      branch: 'feature/test',
      key: '/tmp/repo\0/tmp/repo-feature\0terminal-2',
      worktreeTerminalKey: '/tmp/repo\0/tmp/repo-feature',
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

  test('external open drain kick plan schedules rerun when a drain is already active', () => {
    expect(createExternalOpenDrainKickPlan({ disposed: false, draining: true })).toEqual({
      kind: 'schedule-rerun',
    })
  })
})
