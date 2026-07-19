import { parseTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'
import type { RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { workspaceTerminalAvailable, workspaceWorktreesAvailable } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type ClientWorkspaceIntent = Extract<
  ClientEffectIntent,
  | { type: 'open-workspace-requested' }
  | { type: 'open-workspace-path-requested' }
  | { type: 'open-remote-workspace-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'create-worktree-requested' }
  | { type: 'terminal-new-tab-requested' }
  | { type: 'workspace-pane-close-tab-or-window-requested' }
  | { type: 'close-workspace-requested' }
  | { type: 'cycle-workspace-requested' }
  | { type: 'workspace-refresh-requested' }
  | { type: 'show-workspace-pane-tab-requested' }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'workspace-zen-mode-toggle-requested' }
>

export type TerminalBellIntentPlan =
  | { kind: 'noop' }
  | { kind: 'unavailable'; reason: 'branch-read-model-unavailable' }
  | {
      kind: 'show-worktree-terminal'
      repoId: WorkspaceId
      branch: string
      terminalSessionId: string
      terminalWorktreeKey: string
    }
  | {
      kind: 'show-detached-worktree-terminal'
      repoId: WorkspaceId
      worktreePath: string
      terminalSessionId: string
    }

export type AppLevelIntentPlan =
  | { kind: 'noop' }
  | { kind: 'reset-layout' }
  | { kind: 'open-settings'; page: SettingsPage }
  | { kind: 'set-theme-pref'; pref: ThemePref }
  | { kind: 'set-lang-pref'; pref: LangPref }
  | { kind: 'clear-recent-workspaces' }
  | { kind: 'ensure-recent-workspace-open'; entry: WorkspaceSessionEntry }

export type WorkspaceIntentPlan =
  | { kind: 'noop' }
  | { kind: 'open-workspace' }
  | { kind: 'open-workspace-path' }
  | { kind: 'open-clone-repo' }
  | { kind: 'open-remote-workspace' }
  | { kind: 'create-worktree' }
  | { kind: 'new-terminal-tab'; workspaceId: WorkspaceId; target: WorkspacePaneCommandTarget }
  | { kind: 'close-workspace-pane-tab-or-window'; workspaceId: WorkspaceId; target: WorkspacePaneCommandTarget }
  | { kind: 'close-workspace'; workspaceId: WorkspaceId }
  | { kind: 'close-window' }
  | { kind: 'cycle-workspace'; direction: 1 | -1 }
  | { kind: 'refresh-workspace'; workspaceId: WorkspaceId; workspaceRuntimeId: string }
  | {
      kind: 'show-workspace-pane-tab'
      workspaceId: WorkspaceId
      target: WorkspacePaneCommandTarget
      tab: WorkspacePaneTabType
    }
  | { kind: 'terminal-primary-action'; workspaceId: WorkspaceId; target: WorkspacePaneCommandTarget }
  | { kind: 'toggle-zen-mode' }

export type ExternalOpenDrainKickPlan = { kind: 'ignore' } | { kind: 'schedule-rerun' } | { kind: 'start-drain' }

interface AppLevelIntentPlanContext {
  overlayBlocked: boolean
}

interface WorkspaceIntentPlanContext {
  overlayBlocked: boolean
  workspaceShortcutSuppressed: boolean
  terminalFocused: boolean
  currentWorkspaceId: WorkspaceId | null
  currentWorkspaceRuntimeId: string | null
  currentWorkspaceCapability: Pick<WorkspaceState['capability'], 'kind' | 'probe'> | null
  currentWorkspaceCanExecute: boolean
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
}

export function createTerminalBellIntentPlan(
  repo: Pick<WorkspaceState, 'id'> | undefined,
  branchReadModel: RepoBranchReadModelData | null,
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
): TerminalBellIntentPlan {
  if (!repo) return { kind: 'noop' }
  const parsedKey = event.terminalWorktreeKey ? parseTerminalWorktreeKey(event.terminalWorktreeKey) : null
  if (parsedKey && parsedKey.workspaceId === repo.id && event.terminalSessionId) {
    if (!branchReadModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
    const worktreePath = parseCanonicalWorkspaceLocator(parsedKey.worktreeId)?.path
    const branch = worktreePath
      ? branchReadModel.branches.find((candidate) => candidate.worktree?.path === worktreePath)
      : null
    if (branch) {
      return {
        kind: 'show-worktree-terminal',
        repoId: repo.id,
        branch: branch.name,
        terminalSessionId: event.terminalSessionId,
        terminalWorktreeKey: event.terminalWorktreeKey!,
      }
    }
    if (worktreePath && branchReadModel.worktreesByPath[worktreePath]) {
      return {
        kind: 'show-detached-worktree-terminal',
        repoId: repo.id,
        worktreePath,
        terminalSessionId: event.terminalSessionId,
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
    case 'open-recent-workspace-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'ensure-recent-workspace-open', entry: event.entry }
  }
  return null
}

export function createWorkspaceIntentPlan(
  event: ClientEffectIntent,
  context: WorkspaceIntentPlanContext,
): WorkspaceIntentPlan | null {
  if (!isClientWorkspaceIntent(event)) return null
  if (event.type === 'workspace-pane-close-tab-or-window-requested') {
    if (!context.currentWorkspaceId || !context.currentWorkspacePaneCommandTarget) return { kind: 'close-window' }
    if (context.overlayBlocked || context.workspaceShortcutSuppressed) return { kind: 'noop' }
    return {
      kind: 'close-workspace-pane-tab-or-window',
      workspaceId: context.currentWorkspaceId,
      target: context.currentWorkspacePaneCommandTarget,
    }
  }
  if (context.overlayBlocked) return { kind: 'noop' }
  switch (event.type) {
    case 'open-workspace-requested':
      return { kind: 'open-workspace' }
    case 'open-workspace-path-requested':
      return { kind: 'open-workspace-path' }
    case 'clone-repo-requested':
      return { kind: 'open-clone-repo' }
    case 'create-worktree-requested':
      if (
        context.workspaceShortcutSuppressed ||
        !context.currentWorkspaceCanExecute ||
        !context.currentWorkspaceId ||
        context.currentWorkspaceCapability?.kind !== 'git' ||
        !workspaceWorktreesAvailable(context.currentWorkspaceCapability.probe)
      )
        return { kind: 'noop' }
      return { kind: 'create-worktree' }
    case 'open-remote-workspace-requested':
      return { kind: 'open-remote-workspace' }
    case 'terminal-new-tab-requested':
      if (
        !context.currentWorkspaceId ||
        !context.currentWorkspaceCanExecute ||
        !context.currentWorkspacePaneCommandTarget ||
        !workspaceTerminalAvailable(context.currentWorkspaceCapability?.probe)
      )
        return { kind: 'noop' }
      return {
        kind: 'new-terminal-tab',
        workspaceId: context.currentWorkspaceId,
        target: context.currentWorkspacePaneCommandTarget,
      }
    case 'close-workspace-requested':
      if (context.workspaceShortcutSuppressed) return { kind: 'noop' }
      return context.currentWorkspaceId
        ? { kind: 'close-workspace', workspaceId: context.currentWorkspaceId }
        : { kind: 'close-window' }
    case 'cycle-workspace-requested':
      return context.workspaceShortcutSuppressed
        ? { kind: 'noop' }
        : { kind: 'cycle-workspace', direction: event.direction }
    case 'workspace-refresh-requested':
      if (
        context.workspaceShortcutSuppressed ||
        context.terminalFocused ||
        !context.currentWorkspaceId ||
        !context.currentWorkspaceRuntimeId ||
        !context.currentWorkspaceCapability
      )
        return { kind: 'noop' }
      return {
        kind: 'refresh-workspace',
        workspaceId: context.currentWorkspaceId,
        workspaceRuntimeId: context.currentWorkspaceRuntimeId,
      }
    case 'show-workspace-pane-tab-requested':
      if (
        context.workspaceShortcutSuppressed ||
        !context.currentWorkspaceId ||
        !context.currentWorkspacePaneCommandTarget
      )
        return { kind: 'noop' }
      return {
        kind: 'show-workspace-pane-tab',
        workspaceId: context.currentWorkspaceId,
        target: context.currentWorkspacePaneCommandTarget,
        tab: event.tab,
      }
    case 'terminal-primary-action-requested':
      if (
        context.workspaceShortcutSuppressed ||
        !context.currentWorkspaceCanExecute ||
        !context.currentWorkspaceId ||
        !context.currentWorkspacePaneCommandTarget ||
        !workspaceTerminalAvailable(context.currentWorkspaceCapability?.probe)
      )
        return { kind: 'noop' }
      return {
        kind: 'terminal-primary-action',
        workspaceId: context.currentWorkspaceId,
        target: context.currentWorkspacePaneCommandTarget,
      }
    case 'workspace-zen-mode-toggle-requested':
      if (context.workspaceShortcutSuppressed || context.terminalFocused || !context.currentWorkspaceId)
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
    event.type === 'open-workspace-requested' ||
    event.type === 'open-workspace-path-requested' ||
    event.type === 'open-remote-workspace-requested' ||
    event.type === 'clone-repo-requested' ||
    event.type === 'create-worktree-requested' ||
    event.type === 'terminal-new-tab-requested' ||
    event.type === 'workspace-pane-close-tab-or-window-requested' ||
    event.type === 'close-workspace-requested' ||
    event.type === 'cycle-workspace-requested' ||
    event.type === 'workspace-refresh-requested' ||
    event.type === 'show-workspace-pane-tab-requested' ||
    event.type === 'terminal-primary-action-requested' ||
    event.type === 'workspace-zen-mode-toggle-requested'
  )
}
