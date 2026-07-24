import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { terminalExecutionCoordinates } from '#/shared/terminal-types.ts'
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
  | { type: 'workspace-pane-close-tab-requested' }
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
  | { kind: 'show-workspace-root-terminal'; workspaceId: WorkspaceId; terminalSessionId: string }
  | {
      kind: 'show-worktree-terminal'
      workspaceId: WorkspaceId
      branch: string
      terminalSessionId: string
      terminalFilesystemTargetKey: string
    }
  | {
      kind: 'show-detached-worktree-terminal'
      workspaceId: WorkspaceId
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
  branchReadModel: RepoBranchReadModelData | null,
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
): TerminalBellIntentPlan {
  if (!workspace) return { kind: 'noop' }
  const coordinates = terminalExecutionCoordinates(event.session.target)
  if (coordinates.workspaceId === workspace.id && coordinates.workspaceRuntimeId === workspace.workspaceRuntimeId) {
    if (event.session.target.kind === 'workspace-root' && event.session.presentation.kind === 'workspace-root') {
      return {
        kind: 'show-workspace-root-terminal',
        workspaceId: workspace.id,
        terminalSessionId: event.terminalSessionId,
      }
    }
    if (event.session.target.kind !== 'git-worktree' || event.session.presentation.kind !== 'git-worktree') {
      return { kind: 'noop' }
    }
    if (!branchReadModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
    const worktreePath = parseCanonicalWorkspaceLocator(event.session.target.root)?.path
    if (!worktreePath || !branchReadModel.worktreesByPath[worktreePath]) return { kind: 'noop' }
    const head = event.session.presentation.head
    if (head.kind === 'branch') {
      const branch = branchReadModel.branches.find((candidate) => candidate.name === head.branchName)
      if (branch?.worktree?.path !== worktreePath) return { kind: 'noop' }
      return {
        kind: 'show-worktree-terminal',
        workspaceId: workspace.id,
        branch: head.branchName,
        terminalSessionId: event.terminalSessionId,
        terminalFilesystemTargetKey: formatTerminalFilesystemTargetKey(
          coordinates.workspaceId,
          coordinates.executionRootId,
        ),
      }
    }
    return {
      kind: 'show-detached-worktree-terminal',
      workspaceId: workspace.id,
      worktreePath,
      terminalSessionId: event.terminalSessionId,
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

function isClientWorkspaceIntent(event: ClientEffectIntent): event is ClientWorkspaceIntent {
  return (
    event.type === 'open-workspace-requested' ||
    event.type === 'open-workspace-path-requested' ||
    event.type === 'open-remote-workspace-requested' ||
    event.type === 'clone-repo-requested' ||
    event.type === 'create-worktree-requested' ||
    event.type === 'terminal-new-tab-requested' ||
    event.type === 'workspace-pane-close-tab-requested' ||
    event.type === 'close-workspace-requested' ||
    event.type === 'cycle-workspace-requested' ||
    event.type === 'workspace-refresh-requested' ||
    event.type === 'show-workspace-pane-tab-requested' ||
    event.type === 'terminal-primary-action-requested' ||
    event.type === 'workspace-zen-mode-toggle-requested'
  )
}
