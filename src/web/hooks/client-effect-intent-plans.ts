import { parseTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'
import type { RepoBranchSnapshotData } from '#/web/repo-branch-read-model.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'

type ClientWorkspaceIntent = Extract<
  ClientEffectIntent,
  | { type: 'open-repo-requested' }
  | { type: 'open-repo-path-requested' }
  | { type: 'open-remote-workspace-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'create-worktree-requested' }
  | { type: 'terminal-new-tab-requested' }
  | { type: 'workspace-pane-close-tab-or-window-requested' }
  | { type: 'close-repo-requested' }
  | { type: 'cycle-repo-requested' }
  | { type: 'repo-refresh-requested' }
  | { type: 'show-workspace-pane-tab-requested' }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'workspace-zen-mode-toggle-requested' }
>

export type TerminalBellIntentPlan =
  | { kind: 'noop' }
  | { kind: 'unavailable'; reason: 'branch-read-model-unavailable' }
  | {
      kind: 'show-worktree-terminal'
      repoId: string
      branch: string
      terminalSessionId: string
      terminalWorktreeKey: string
    }

export type AppLevelIntentPlan =
  | { kind: 'noop' }
  | { kind: 'reset-layout' }
  | { kind: 'open-settings'; page: SettingsPage }
  | { kind: 'set-theme-pref'; pref: ThemePref }
  | { kind: 'set-lang-pref'; pref: LangPref }
  | { kind: 'clear-recent-workspaces' }
  | { kind: 'ensure-recent-repo-open'; entry: WorkspaceSessionEntry }

export type WorkspaceIntentPlan =
  | { kind: 'noop' }
  | { kind: 'open-repo' }
  | { kind: 'open-repo-path' }
  | { kind: 'open-clone-repo' }
  | { kind: 'open-remote-workspace' }
  | { kind: 'create-worktree' }
  | { kind: 'new-terminal-tab'; repoId: string; target: WorkspacePaneCommandTarget }
  | { kind: 'close-workspace-pane-tab-or-window'; repoId: string; target: WorkspacePaneCommandTarget }
  | { kind: 'close-repo'; repoId: string }
  | { kind: 'close-window' }
  | { kind: 'cycle-repo'; direction: 1 | -1 }
  | { kind: 'refresh-repo'; repoId: string; repoRuntimeId: string }
  | { kind: 'show-workspace-pane-tab'; repoId: string; target: WorkspacePaneCommandTarget; tab: WorkspacePaneTabType }
  | { kind: 'terminal-primary-action'; repoId: string; target: WorkspacePaneCommandTarget }
  | { kind: 'toggle-zen-mode' }

export type ExternalOpenDrainKickPlan = { kind: 'ignore' } | { kind: 'schedule-rerun' } | { kind: 'start-drain' }

interface AppLevelIntentPlanContext {
  overlayBlocked: boolean
}

interface WorkspaceIntentPlanContext {
  overlayBlocked: boolean
  workspaceShortcutSuppressed: boolean
  terminalFocused: boolean
  currentRepoId: string | null
  currentRepo: Pick<RepoState, 'id' | 'repoRuntimeId'> | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
}

export function createTerminalBellIntentPlan(
  repo: Pick<RepoState, 'id'> | undefined,
  branchReadModel: RepoBranchSnapshotData | null,
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
): TerminalBellIntentPlan {
  if (!repo) return { kind: 'noop' }
  const parsedKey = event.terminalWorktreeKey ? parseTerminalWorktreeKey(event.terminalWorktreeKey) : null
  if (parsedKey && parsedKey.repoRoot === repo.id && event.terminalSessionId) {
    if (!branchReadModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
    const branch = branchReadModel.branches.find((candidate) => candidate.worktree?.path === parsedKey.worktreePath)
    if (branch) {
      return {
        kind: 'show-worktree-terminal',
        repoId: repo.id,
        branch: branch.name,
        terminalSessionId: event.terminalSessionId,
        terminalWorktreeKey: event.terminalWorktreeKey!,
      }
    }
  }
  return { kind: 'noop' }
}

export function createAppLevelIntentPlan(
  event: ClientEffectIntent,
  context: AppLevelIntentPlanContext,
): AppLevelIntentPlan | null {
  switch (event.type) {
    case 'layout-reset-requested':
      return { kind: 'reset-layout' }
    case 'open-settings-requested':
      return { kind: 'open-settings', page: event.page }
    case 'theme-pref-set-requested':
      return { kind: 'set-theme-pref', pref: event.pref }
    case 'lang-pref-set-requested':
      return { kind: 'set-lang-pref', pref: event.pref }
    case 'clear-recent-workspaces-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'clear-recent-workspaces' }
    case 'open-recent-repo-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'ensure-recent-repo-open', entry: event.entry }
  }
  return null
}

export function createWorkspaceIntentPlan(
  event: ClientEffectIntent,
  context: WorkspaceIntentPlanContext,
): WorkspaceIntentPlan | null {
  if (!isClientWorkspaceIntent(event)) return null
  if (event.type === 'workspace-pane-close-tab-or-window-requested') {
    if (!context.currentRepoId || !context.currentWorkspacePaneCommandTarget) return { kind: 'close-window' }
    if (context.overlayBlocked || context.workspaceShortcutSuppressed) return { kind: 'noop' }
    return {
      kind: 'close-workspace-pane-tab-or-window',
      repoId: context.currentRepoId,
      target: context.currentWorkspacePaneCommandTarget,
    }
  }
  if (context.overlayBlocked) return { kind: 'noop' }
  switch (event.type) {
    case 'open-repo-requested':
      return { kind: 'open-repo' }
    case 'open-repo-path-requested':
      return { kind: 'open-repo-path' }
    case 'clone-repo-requested':
      return { kind: 'open-clone-repo' }
    case 'create-worktree-requested':
      if (context.workspaceShortcutSuppressed || !context.currentRepoId) return { kind: 'noop' }
      return { kind: 'create-worktree' }
    case 'open-remote-workspace-requested':
      return { kind: 'open-remote-workspace' }
    case 'terminal-new-tab-requested':
      if (!context.currentRepoId || !context.currentWorkspacePaneCommandTarget) return { kind: 'noop' }
      return {
        kind: 'new-terminal-tab',
        repoId: context.currentRepoId,
        target: context.currentWorkspacePaneCommandTarget,
      }
    case 'close-repo-requested':
      if (context.workspaceShortcutSuppressed) return { kind: 'noop' }
      return context.currentRepoId ? { kind: 'close-repo', repoId: context.currentRepoId } : { kind: 'close-window' }
    case 'cycle-repo-requested':
      return context.workspaceShortcutSuppressed ? { kind: 'noop' } : { kind: 'cycle-repo', direction: event.direction }
    case 'repo-refresh-requested':
      if (context.workspaceShortcutSuppressed || context.terminalFocused || !context.currentRepo)
        return { kind: 'noop' }
      return { kind: 'refresh-repo', repoId: context.currentRepo.id, repoRuntimeId: context.currentRepo.repoRuntimeId }
    case 'show-workspace-pane-tab-requested':
      if (context.workspaceShortcutSuppressed || !context.currentRepoId || !context.currentWorkspacePaneCommandTarget)
        return { kind: 'noop' }
      return {
        kind: 'show-workspace-pane-tab',
        repoId: context.currentRepoId,
        target: context.currentWorkspacePaneCommandTarget,
        tab: event.tab,
      }
    case 'terminal-primary-action-requested':
      if (context.workspaceShortcutSuppressed || !context.currentRepoId || !context.currentWorkspacePaneCommandTarget)
        return { kind: 'noop' }
      return {
        kind: 'terminal-primary-action',
        repoId: context.currentRepoId,
        target: context.currentWorkspacePaneCommandTarget,
      }
    case 'workspace-zen-mode-toggle-requested':
      if (context.workspaceShortcutSuppressed || context.terminalFocused || !context.currentRepoId)
        return { kind: 'noop' }
      return { kind: 'toggle-zen-mode' }
  }
}

export function createExternalOpenDrainKickPlan(context: {
  disposed: boolean
  draining: boolean
}): ExternalOpenDrainKickPlan {
  if (context.disposed) return { kind: 'ignore' }
  if (context.draining) return { kind: 'schedule-rerun' }
  return { kind: 'start-drain' }
}

function isClientWorkspaceIntent(event: ClientEffectIntent): event is ClientWorkspaceIntent {
  return (
    event.type === 'open-repo-requested' ||
    event.type === 'open-repo-path-requested' ||
    event.type === 'open-remote-workspace-requested' ||
    event.type === 'clone-repo-requested' ||
    event.type === 'create-worktree-requested' ||
    event.type === 'terminal-new-tab-requested' ||
    event.type === 'workspace-pane-close-tab-or-window-requested' ||
    event.type === 'close-repo-requested' ||
    event.type === 'cycle-repo-requested' ||
    event.type === 'repo-refresh-requested' ||
    event.type === 'show-workspace-pane-tab-requested' ||
    event.type === 'terminal-primary-action-requested' ||
    event.type === 'workspace-zen-mode-toggle-requested'
  )
}
