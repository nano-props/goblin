import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { terminalExecutionCoordinates } from '#/shared/terminal-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { workspaceTerminalAvailable, workspaceWorktreesAvailable } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type ClientAppIntent = Extract<
  ClientEffectIntent,
  | { type: 'layout-reset-requested' }
  | { type: 'open-settings-requested' }
  | { type: 'theme-pref-set-requested' }
  | { type: 'lang-pref-set-requested' }
  | { type: 'clear-recent-workspaces-requested' }
  | { type: 'open-recent-workspace-requested' }
  | { type: 'open-workspace-requested' }
  | { type: 'open-workspace-path-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'open-remote-workspace-requested' }
>

export type ClientWorkspaceIntent = Extract<
  ClientEffectIntent,
  | { type: 'create-worktree-requested' }
  | { type: 'terminal-new-tab-requested' }
  | { type: 'workspace-pane-close-tab-requested' }
  | { type: 'close-workspace-requested' }
  | { type: 'cycle-workspace-requested' }
  | { type: 'workspace-refresh-requested' }
  | { type: 'show-workspace-pane-tab-requested' }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'workspace-zen-mode-toggle-requested' }
>

export type TerminalBellIntentPlan =
  { kind: 'noop' } | { kind: 'unavailable'; reason: 'snapshot-unavailable' } | { kind: 'show-terminal' }

export type AppLevelIntentPlan =
  | { kind: 'noop' }
  | { kind: 'reset-layout' }
  | { kind: 'open-settings'; page: SettingsPage }
  | { kind: 'set-theme-pref'; pref: ThemePref }
  | { kind: 'set-lang-pref'; pref: LangPref }
  | { kind: 'clear-recent-workspaces' }
  | { kind: 'ensure-recent-workspace-open'; entry: WorkspaceSessionEntry }
  | { kind: 'open-workspace' }
  | { kind: 'open-workspace-path' }
  | { kind: 'open-clone-repo' }
  | { kind: 'open-remote-workspace' }

export type WorkspaceIntentPlan =
  | { kind: 'noop' }
  | { kind: 'create-worktree' }
  | { kind: 'new-terminal-tab'; workspaceId: WorkspaceId; target: WorkspacePaneCommandTarget }
  | { kind: 'close-workspace-pane-tab'; workspaceId: WorkspaceId; target: WorkspacePaneCommandTarget }
  | { kind: 'close-workspace'; workspaceId: WorkspaceId }
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

export function clientEffectIntentRequiresWorkspaceBootstrap(event: ClientEffectIntent): boolean {
  switch (event.type) {
    case 'app-quitting':
    case 'open-settings-requested':
    case 'theme-pref-set-requested':
    case 'lang-pref-set-requested':
    case 'open-workspace-path-requested':
    case 'clone-repo-requested':
    case 'open-remote-workspace-requested':
      return false
    case 'open-workspace-requested':
    case 'create-worktree-requested':
    case 'terminal-new-tab-requested':
    case 'workspace-pane-close-tab-requested':
    case 'close-workspace-requested':
    case 'cycle-workspace-requested':
    case 'workspace-refresh-requested':
    case 'show-workspace-pane-tab-requested':
    case 'terminal-primary-action-requested':
    case 'workspace-zen-mode-toggle-requested':
    case 'layout-reset-requested':
    case 'clear-recent-workspaces-requested':
    case 'open-recent-workspace-requested':
    case 'terminal-bell-click':
    case 'external-open-enqueued':
      return true
  }
}

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
  workspace: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'> | undefined,
  repositoryFacts: { snapshot: RepoSnapshot } | null,
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
): TerminalBellIntentPlan {
  if (!workspace) return { kind: 'noop' }
  const coordinates = terminalExecutionCoordinates(event.session.target)
  if (coordinates.workspaceId === workspace.id && coordinates.workspaceRuntimeId === workspace.workspaceRuntimeId) {
    if (event.session.target.kind === 'workspace-root' && event.session.presentation.kind === 'workspace-root') {
      return { kind: 'show-terminal' }
    }
    if (event.session.target.kind !== 'git-worktree' || event.session.presentation.kind !== 'git-worktree') {
      return { kind: 'noop' }
    }
    if (!repositoryFacts) return { kind: 'unavailable', reason: 'snapshot-unavailable' }
    const worktreePath = parseCanonicalWorkspaceLocator(event.session.target.root)?.path
    if (!worktreePath) return { kind: 'noop' }
    return repositoryFacts.snapshot.worktrees.some((worktree) => worktree.path === worktreePath)
      ? { kind: 'show-terminal' }
      : { kind: 'noop' }
  }
  return { kind: 'noop' }
}

export function createAppLevelIntentPlan(
  event: ClientAppIntent,
  context: AppLevelIntentPlanContext,
): AppLevelIntentPlan {
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
    case 'open-workspace-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'open-workspace' }
    case 'open-workspace-path-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'open-workspace-path' }
    case 'clone-repo-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'open-clone-repo' }
    case 'open-remote-workspace-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'open-remote-workspace' }
  }
}

export function createWorkspaceIntentPlan(
  event: ClientWorkspaceIntent,
  context: WorkspaceIntentPlanContext,
): WorkspaceIntentPlan {
  if (event.type === 'workspace-pane-close-tab-requested') {
    if (!context.currentWorkspaceId || !context.currentWorkspacePaneCommandTarget) return { kind: 'noop' }
    if (context.overlayBlocked || context.workspaceShortcutSuppressed) return { kind: 'noop' }
    return {
      kind: 'close-workspace-pane-tab',
      workspaceId: context.currentWorkspaceId,
      target: context.currentWorkspacePaneCommandTarget,
    }
  }
  if (context.overlayBlocked) return { kind: 'noop' }
  switch (event.type) {
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
        : { kind: 'noop' }
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
