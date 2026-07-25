import { isSettingsPage, type SettingsPage } from '#/shared/settings-pages.ts'
import { normalizeWorkspaceSessionEntry, type WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'
import { isWorkspacePaneTabType, type WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { isValidTerminalSessionBase } from '#/shared/terminal-validators.ts'

type TerminalBellClickIntent = {
  type: 'terminal-bell-click'
  terminalSessionId: string
  session: TerminalSessionBase
}

export type ClientEffectIntent =
  | { type: 'open-workspace-requested' }
  | { type: 'open-workspace-path-requested' }
  | { type: 'open-remote-workspace-requested' }
  | { type: 'clone-repo-requested' }
  | { type: 'create-worktree-requested' }
  | { type: 'app-quitting' }
  | { type: 'terminal-new-tab-requested' }
  | { type: 'workspace-pane-close-tab-requested' }
  | { type: 'close-workspace-requested' }
  | { type: 'cycle-workspace-requested'; direction: 1 | -1 }
  | { type: 'workspace-refresh-requested' }
  | { type: 'show-workspace-pane-tab-requested'; tab: WorkspacePaneTabType }
  | { type: 'terminal-primary-action-requested' }
  | { type: 'workspace-zen-mode-toggle-requested' }
  | { type: 'layout-reset-requested' }
  | { type: 'open-settings-requested'; page: SettingsPage }
  | { type: 'theme-pref-set-requested'; pref: ThemePref }
  | { type: 'lang-pref-set-requested'; pref: LangPref }
  | { type: 'clear-recent-workspaces-requested' }
  | { type: 'open-recent-workspace-requested'; entry: WorkspaceSessionEntry }
  | TerminalBellClickIntent
  | { type: 'external-open-enqueued' }

export type ClientEffectIntentType = ClientEffectIntent['type']

export function isClientEffectIntent(event: unknown): event is ClientEffectIntent {
  if (!isRecord(event)) return false
  switch (event.type) {
    case 'open-workspace-requested':
    case 'open-workspace-path-requested':
    case 'open-remote-workspace-requested':
    case 'clone-repo-requested':
    case 'create-worktree-requested':
    case 'app-quitting':
    case 'terminal-new-tab-requested':
    case 'workspace-pane-close-tab-requested':
    case 'close-workspace-requested':
    case 'workspace-refresh-requested':
    case 'terminal-primary-action-requested':
    case 'workspace-zen-mode-toggle-requested':
    case 'layout-reset-requested':
    case 'clear-recent-workspaces-requested':
    case 'external-open-enqueued':
      return true
    case 'cycle-workspace-requested':
      return event.direction === 1 || event.direction === -1
    case 'show-workspace-pane-tab-requested':
      return isWorkspacePaneTabType(typeof event.tab === 'string' ? event.tab : null)
    case 'open-settings-requested':
      return isSettingsPage(typeof event.page === 'string' ? event.page : null)
    case 'theme-pref-set-requested':
      return isThemePref(event.pref)
    case 'lang-pref-set-requested':
      return isLangPref(event.pref)
    case 'open-recent-workspace-requested':
      return isWorkspaceSessionEntry(event.entry)
    case 'terminal-bell-click':
      return typeof event.terminalSessionId === 'string' && isValidTerminalSessionBase(event.session)
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isThemePref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark'
}

function isLangPref(value: unknown): value is LangPref {
  return value === 'auto' || value === 'en' || value === 'zh' || value === 'ko' || value === 'ja'
}

function isWorkspaceSessionEntry(value: unknown): value is WorkspaceSessionEntry {
  return isRecord(value) && normalizeWorkspaceSessionEntry(value) !== null
}
