import { app } from 'electron'
import { broadcastRpcEvent } from '#/main/events.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { setMenuRecentRepos, setMenuShortcutsDisabled, setMenuSwapCloseShortcuts } from '#/main/menu-state.ts'
import { syncGlobalShortcuts } from '#/main/shortcuts.ts'
import { setSettingsGlobalShortcutState } from '#/main/settings-server-facade.ts'
import type { EditorAppState, I18nPayload, TerminalAppState } from '#/shared/rpc.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

export function applyFetchIntervalEffects(sec: number): void {
  broadcastRpcEvent({ type: 'fetch-interval-changed', sec })
}

export function applyTerminalNotificationsEnabledEffects(enabled: boolean): void {
  broadcastRpcEvent({ type: 'terminal-notifications-changed', enabled })
}

export function applyShortcutsDisabledEffects(disabled: boolean): void {
  setMenuShortcutsDisabled(disabled)
  buildAppMenu()
  broadcastRpcEvent({ type: 'shortcuts-disabled-changed', disabled })
}

export function applySwapCloseShortcutsEffects(swapped: boolean): void {
  setMenuSwapCloseShortcuts(swapped)
  buildAppMenu()
  broadcastRpcEvent({ type: 'swap-close-shortcuts-changed', swapped })
}

export function applyToggleDetailOnActionBarBlankClickEffects(enabled: boolean): void {
  broadcastRpcEvent({ type: 'toggle-detail-on-action-bar-blank-click-changed', enabled })
}

export async function applyGlobalShortcutDisabledEffects(disabled: boolean, accelerator: string): Promise<void> {
  const registered = syncGlobalShortcuts(disabled, accelerator)
  await setSettingsGlobalShortcutState(registered)
  broadcastRpcEvent({ type: 'global-shortcut-disabled-changed', disabled })
  broadcastRpcEvent({ type: 'global-shortcut-changed', state: { accelerator, registered } })
}

export async function applyGlobalShortcutEffects(accelerator: string, registered: boolean): Promise<void> {
  await setSettingsGlobalShortcutState(registered)
  broadcastRpcEvent({ type: 'global-shortcut-changed', state: { accelerator, registered } })
}

export function applyTerminalAppEffects(payload: TerminalAppState): void {
  broadcastRpcEvent({ type: 'terminal-app-changed', ...payload })
}

export function applyEditorAppEffects(payload: EditorAppState): void {
  broadcastRpcEvent({ type: 'editor-app-changed', ...payload })
}

export function applyRecentReposEffects(recentRepos: RepoSessionEntry[]): void {
  setMenuRecentRepos(recentRepos)
  buildAppMenu()
}

export function applyClearRecentReposEffects(): void {
  app.clearRecentDocuments()
  setMenuRecentRepos([])
  buildAppMenu()
}

export function applyI18nEffects(payload: I18nPayload): void {
  buildAppMenu()
  broadcastRpcEvent({ type: 'i18n-changed', payload })
}
