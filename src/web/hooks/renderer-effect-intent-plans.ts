import { parseTerminalSessionKey, worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import type { DetailTab, RepoState } from '#/web/stores/repos/types.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'

type WorkspaceRendererIntent = Extract<
  RendererEffectIntent,
  | { type: 'open-repo-requested' }
  | { type: 'open-repo-path-requested' }
  | { type: 'open-remote-repo-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'close-repo-requested' }
  | { type: 'cycle-repo-requested' }
  | { type: 'repo-refresh-requested' }
  | { type: 'show-detail-tab-requested' }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'toggle-detail-requested' }
>

export type TerminalBellIntentPlan =
  | { kind: 'noop' }
  | { kind: 'show-repo-terminal'; repoId: string }
  | {
      kind: 'show-worktree-terminal'
      repoId: string
      branch: string
      key: string
      worktreeTerminalKey: string
    }

export type AppLevelIntentPlan =
  | { kind: 'noop' }
  | { kind: 'set-workspace-layout'; layout: WorkspaceLayout }
  | { kind: 'reset-workspace-layout' }
  | { kind: 'open-settings'; page: SettingsPage }
  | { kind: 'set-theme-pref'; pref: ThemePref }
  | { kind: 'set-lang-pref'; pref: LangPref }
  | { kind: 'clear-recent-repos' }
  | { kind: 'ensure-recent-repo-open'; entry: RepoSessionEntry }

export type WorkspaceIntentPlan =
  | { kind: 'noop' }
  | { kind: 'open-repo' }
  | { kind: 'open-repo-path' }
  | { kind: 'open-clone-repo' }
  | { kind: 'open-remote-repo' }
  | { kind: 'close-repo'; repoId: string }
  | { kind: 'close-window' }
  | { kind: 'cycle-repo'; direction: 1 | -1 }
  | { kind: 'refresh-repo'; repoId: string; token: number }
  | { kind: 'show-detail-tab'; repoId: string; tab: DetailTab }
  | { kind: 'terminal-primary-action'; repoId: string }
  | { kind: 'toggle-detail'; repoId: string }

export type ExternalOpenDrainKickPlan = { kind: 'ignore' } | { kind: 'schedule-rerun' } | { kind: 'start-drain' }

interface AppLevelIntentPlanContext {
  overlayBlocked: boolean
}

interface WorkspaceIntentPlanContext {
  overlayBlocked: boolean
  workspaceShortcutSuppressed: boolean
  terminalFocused: boolean
  currentRepoId: string | null
  currentRepo: Pick<RepoState, 'id' | 'instanceToken'> | null
}

export function createTerminalBellIntentPlan(
  repo: RepoState | undefined,
  event: Extract<RendererEffectIntent, { type: 'terminal-bell-click' }>,
): TerminalBellIntentPlan {
  if (!repo) return { kind: 'noop' }
  const parsedKey = event.key ? parseTerminalSessionKey(event.key) : null
  if (parsedKey && parsedKey.repoRoot === repo.id && event.key) {
    const branch = repo.data.branches.find((candidate) => candidate.worktree?.path === parsedKey.worktreePath)
    if (branch) {
      return {
        kind: 'show-worktree-terminal',
        repoId: repo.id,
        branch: branch.name,
        key: event.key,
        worktreeTerminalKey: worktreeTerminalKey(parsedKey.repoRoot, parsedKey.worktreePath),
      }
    }
  }
  return { kind: 'show-repo-terminal', repoId: repo.id }
}

export function createAppLevelIntentPlan(
  event: RendererEffectIntent,
  context: AppLevelIntentPlanContext,
): AppLevelIntentPlan | null {
  switch (event.type) {
    case 'workspace-layout-set-requested':
      return { kind: 'set-workspace-layout', layout: event.layout }
    case 'workspace-layout-reset-requested':
      return { kind: 'reset-workspace-layout' }
    case 'open-settings-requested':
      return { kind: 'open-settings', page: event.page }
    case 'theme-pref-set-requested':
      return { kind: 'set-theme-pref', pref: event.pref }
    case 'lang-pref-set-requested':
      return { kind: 'set-lang-pref', pref: event.pref }
    case 'clear-recent-repos-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'clear-recent-repos' }
    case 'open-recent-repo-requested':
      return context.overlayBlocked ? { kind: 'noop' } : { kind: 'ensure-recent-repo-open', entry: event.entry }
  }
  return null
}

export function createWorkspaceIntentPlan(
  event: RendererEffectIntent,
  context: WorkspaceIntentPlanContext,
): WorkspaceIntentPlan | null {
  if (!isWorkspaceRendererIntent(event)) return null
  if (context.overlayBlocked) return { kind: 'noop' }
  switch (event.type) {
    case 'open-repo-requested':
      return { kind: 'open-repo' }
    case 'open-repo-path-requested':
      return { kind: 'open-repo-path' }
    case 'clone-repo-requested':
      return { kind: 'open-clone-repo' }
    case 'open-remote-repo-requested':
      return { kind: 'open-remote-repo' }
    case 'close-repo-requested':
      if (context.workspaceShortcutSuppressed) return { kind: 'noop' }
      return context.currentRepoId ? { kind: 'close-repo', repoId: context.currentRepoId } : { kind: 'close-window' }
    case 'cycle-repo-requested':
      return context.workspaceShortcutSuppressed ? { kind: 'noop' } : { kind: 'cycle-repo', direction: event.direction }
    case 'repo-refresh-requested':
      if (context.workspaceShortcutSuppressed || context.terminalFocused || !context.currentRepo)
        return { kind: 'noop' }
      return { kind: 'refresh-repo', repoId: context.currentRepo.id, token: context.currentRepo.instanceToken }
    case 'show-detail-tab-requested':
      if (context.workspaceShortcutSuppressed || !context.currentRepoId) return { kind: 'noop' }
      return { kind: 'show-detail-tab', repoId: context.currentRepoId, tab: event.tab }
    case 'terminal-primary-action-requested':
      if (context.workspaceShortcutSuppressed || !context.currentRepoId) return { kind: 'noop' }
      return { kind: 'terminal-primary-action', repoId: context.currentRepoId }
    case 'toggle-detail-requested':
      if (context.workspaceShortcutSuppressed || !context.currentRepoId) return { kind: 'noop' }
      return { kind: 'toggle-detail', repoId: context.currentRepoId }
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

function isWorkspaceRendererIntent(event: RendererEffectIntent): event is WorkspaceRendererIntent {
  return (
    event.type === 'open-repo-requested' ||
    event.type === 'open-repo-path-requested' ||
    event.type === 'open-remote-repo-requested' ||
    event.type === 'clone-repo-requested' ||
    event.type === 'close-repo-requested' ||
    event.type === 'cycle-repo-requested' ||
    event.type === 'repo-refresh-requested' ||
    event.type === 'show-detail-tab-requested' ||
    event.type === 'terminal-primary-action-requested' ||
    event.type === 'toggle-detail-requested'
  )
}
