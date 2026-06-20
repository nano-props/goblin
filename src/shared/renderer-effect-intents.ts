import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'

export type RendererEffectIntent =
  | { type: 'open-repo-requested' }
  | { type: 'open-repo-path-requested' }
  | { type: 'open-remote-repo-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'app-quitting' }
  | { type: 'close-repo-requested' }
  | { type: 'cycle-repo-requested'; direction: 1 | -1 }
  | { type: 'repo-refresh-requested' }
  | { type: 'show-workspace-pane-view-requested'; tab: 'status' | 'changes' | 'terminal' }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'layout-reset-requested' }
  | { type: 'open-settings-requested'; page: SettingsPage }
  | { type: 'theme-pref-set-requested'; pref: ThemePref }
  | { type: 'lang-pref-set-requested'; pref: LangPref }
  | { type: 'clear-recent-repos-requested' }
  | { type: 'open-recent-repo-requested'; entry: RepoSessionEntry }
  | { type: 'terminal-bell-click'; repoRoot: string; key?: string }
  | { type: 'external-open-enqueued' }

export type RendererEffectIntentType = RendererEffectIntent['type']

export function isRendererEffectIntent(event: unknown): event is RendererEffectIntent {
  if (!event || typeof event !== 'object') return false
  const type = 'type' in event ? event.type : null
  return (
    type === 'open-repo-requested' ||
    type === 'open-repo-path-requested' ||
    type === 'open-remote-repo-requested' ||
    type === 'clone-repo-requested' ||
    type === 'app-quitting' ||
    type === 'close-repo-requested' ||
    type === 'cycle-repo-requested' ||
    type === 'repo-refresh-requested' ||
    type === 'show-workspace-pane-view-requested' ||
    type === 'terminal-primary-action-requested' ||
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
