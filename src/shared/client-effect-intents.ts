import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

export type ClientEffectIntent =
  | { type: 'open-repo-requested' }
  | { type: 'open-repo-path-requested' }
  | { type: 'open-remote-repo-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'app-quitting' }
  | { type: 'terminal-new-tab-requested' }
  | { type: 'workspace-pane-close-tab-or-window-requested' }
  | { type: 'close-repo-requested' }
  | { type: 'cycle-repo-requested'; direction: 1 | -1 }
  | { type: 'repo-refresh-requested' }
  | { type: 'show-workspace-pane-view-requested'; tab: WorkspacePaneView }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'workspace-focus-toggle-requested' }
  | { type: 'layout-reset-requested' }
  | { type: 'open-settings-requested'; page: SettingsPage }
  | { type: 'theme-pref-set-requested'; pref: ThemePref }
  | { type: 'lang-pref-set-requested'; pref: LangPref }
  | { type: 'clear-recent-repos-requested' }
  | { type: 'open-recent-repo-requested'; entry: RepoSessionEntry }
  | { type: 'terminal-bell-click'; repoRoot: string; key?: string }
  | { type: 'external-open-enqueued' }

export type ClientEffectIntentType = ClientEffectIntent['type']

export function isClientEffectIntent(event: unknown): event is ClientEffectIntent {
  if (!event || typeof event !== 'object') return false
  const type = 'type' in event ? event.type : null
  return (
    type === 'open-repo-requested' ||
    type === 'open-repo-path-requested' ||
    type === 'open-remote-repo-requested' ||
    type === 'clone-repo-requested' ||
    type === 'app-quitting' ||
    type === 'terminal-new-tab-requested' ||
    type === 'workspace-pane-close-tab-or-window-requested' ||
    type === 'close-repo-requested' ||
    type === 'cycle-repo-requested' ||
    type === 'repo-refresh-requested' ||
    type === 'show-workspace-pane-view-requested' ||
    type === 'terminal-primary-action-requested' ||
    type === 'workspace-focus-toggle-requested' ||
    type === 'layout-reset-requested' ||
    type === 'open-settings-requested' ||
    type === 'theme-pref-set-requested' ||
    type === 'lang-pref-set-requested' ||
    type === 'clear-recent-repos-requested' ||
    type === 'open-recent-repo-requested' ||
    type === 'terminal-bell-click' ||
    type === 'external-open-enqueued'
  )
}
