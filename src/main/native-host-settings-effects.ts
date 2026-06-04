import { app } from 'electron'
import { broadcastRpcEvent } from '#/main/renderer-surface-events.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { setMenuRecentRepos } from '#/main/menu-state.ts'
import { setSettingsGlobalShortcutState } from '#/main/settings-server-client.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

// Native-host application of server-owned settings changes.
//
// Naming rule:
// - `broadcast*` = publish renderer-visible state that main has already resolved
//   or validated.
// - `apply*` = mutate native host chrome / menu / OS integration state.
//
// Keep this module narrow: only retain effects that are actually shared across
// multiple main-side call sites.
export async function broadcastNativeHostGlobalShortcutState(accelerator: string, registered: boolean): Promise<void> {
  await setSettingsGlobalShortcutState(registered)
  broadcastRpcEvent({ type: 'global-shortcut-changed', state: { accelerator, registered } })
}

export function applyNativeHostRecentReposMenuState(recentRepos: RepoSessionEntry[]): void {
  setMenuRecentRepos(recentRepos)
  buildAppMenu()
}

export function applyNativeHostClearRecentReposState(): void {
  app.clearRecentDocuments()
  setMenuRecentRepos([])
  buildAppMenu()
}
