import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'

export type RendererEffectIntent =
  | { type: 'open-repo-requested' }
  | { type: 'open-repo-path-requested' }
  | { type: 'open-remote-repo-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'close-repo-requested' }
  | { type: 'cycle-repo-requested'; direction: 1 | -1 }
  | { type: 'repo-refresh-requested' }
  | { type: 'show-detail-tab-requested'; tab: 'status' | 'terminal' }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'toggle-detail-requested' }
  | { type: 'workspace-layout-set-requested'; layout: WorkspaceLayout }
  | { type: 'workspace-layout-reset-requested' }
  | { type: 'open-settings-requested'; page: SettingsPage }
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
    type === 'close-repo-requested' ||
    type === 'cycle-repo-requested' ||
    type === 'repo-refresh-requested' ||
    type === 'show-detail-tab-requested' ||
    type === 'terminal-primary-action-requested' ||
    type === 'toggle-detail-requested' ||
    type === 'workspace-layout-set-requested' ||
    type === 'workspace-layout-reset-requested' ||
    type === 'open-settings-requested' ||
    type === 'open-recent-repo-requested' ||
    type === 'terminal-bell-click' ||
    type === 'external-open-enqueued'
  )
}
