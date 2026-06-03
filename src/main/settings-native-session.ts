import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { SessionState } from '#/shared/rpc.ts'
import { toSafeRepoLocator, toSafeSessionRepoEntry } from '#/shared/input-validation.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import {
  addSettingsRecentRepo,
  clearSettingsRecentRepos,
  saveSettingsSession,
} from '#/main/settings-server-facade.ts'
import { applyClearRecentReposEffects, applyRecentReposEffects } from '#/main/settings-native-effects.ts'
import { setMenuWorkspaceLayout } from '#/main/menu-state.ts'

export async function persistSettingsSession(session: SessionState): Promise<void> {
  if (!session || !Array.isArray(session.openRepos)) return
  const openRepos = session.openRepos.map(toSafeSessionRepoEntry).filter((p): p is NonNullable<typeof p> => p !== null)
  const activeRepo = toSafeRepoLocator(session.activeRepo)
  const { workspaceLayout, detailCollapsed, detailFocusMode, detailPaneSizes } = normalizeWorkspaceSessionLayoutState(session)
  const nextSession = {
    openRepos,
    activeRepo: activeRepo && openRepos.some((repo) => repo.id === activeRepo) ? activeRepo : null,
    detailCollapsed,
    detailFocusMode,
    workspaceLayout,
    detailPaneSizes,
    selectedTerminalByWorktree: session.selectedTerminalByWorktree ?? {},
  }
  const persistedSession = await saveSettingsSession(nextSession)
  setMenuWorkspaceLayout(persistedSession.workspaceLayout)
}

function syncRecentDocumentOnAdd(repo: RepoSessionEntry, addRecentDocument: (path: string) => void): void {
  if (repo.kind !== 'local') return
  addRecentDocument(repo.id)
}

export async function addRecentRepoAndApplyEffects(
  repo: unknown,
  options: { addRecentDocument: (path: string) => void },
): Promise<RepoSessionEntry[]> {
  const safeRepo = toSafeSessionRepoEntry(repo)
  if (!safeRepo) return []
  const serverRecentRepos = await addSettingsRecentRepo(safeRepo)
  syncRecentDocumentOnAdd(safeRepo, options.addRecentDocument)
  applyRecentReposEffects(serverRecentRepos)
  return serverRecentRepos
}

export async function clearRecentReposAndApplyEffects(): Promise<void> {
  await clearSettingsRecentRepos()
  applyClearRecentReposEffects()
}
