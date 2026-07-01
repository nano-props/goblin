import { useEffect, useRef, useSyncExternalStore } from 'react'
import { persistWorkspaceSessionState } from '#/web/settings-actions.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { restorableWorkspaceStateFromStore } from '#/web/stores/repos/selector-state.ts'
import { workspaceSessionStateFromRestorableWorkspaceState } from '#/web/restorable-workspace-state.ts'
import { sessionLog } from '#/web/logger.ts'
import { useFiletreeInteractionStore } from '#/web/stores/repos/filetree-interaction-state.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { isWorkspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
const SESSION_SAVE_DEBOUNCE_MS = 200
let workspacePaneTabsCacheVersion = 0

export function useSessionPersistence() {
  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const zenMode = useReposStore((s) => s.zenMode)
  const workspacePaneSize = useReposStore((s) => s.workspacePaneSize)
  const selectedTerminalSessionIdByTerminalWorktree = useReposStore(
    (s) => s.selectedTerminalSessionIdByTerminalWorktree,
  )
  const sessionReady = useReposStore((s) => s.sessionReady)
  const sessionPersistenceReady = useReposStore((s) => s.sessionPersistenceReady)
  const repos = useReposStore((s) => s.repos)
  const workspacePaneTabsVersion = useWorkspacePaneTabsCacheVersion()
  const filetreeInteractionByScope = useFiletreeInteractionStore((s) => s.interactionByScope)
  const lastSavedRef = useRef<string | null>(null)
  const lastImmediateKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // Client -> persistence only. Boot restore runs elsewhere first. sessionReady
    // gates the UI skeleton; sessionPersistenceReady waits for boot-restored
    // server-owned workspace tabs to converge back into the client store.
    if (!sessionReady || !sessionPersistenceReady) return
    const session = workspaceSessionStateFromRestorableWorkspaceState({
      repos,
      restorableWorkspaceState: restorableWorkspaceStateFromStore({
        order,
        activeId,
        zenMode,
        workspacePaneSize,
        selectedTerminalSessionIdByTerminalWorktree,
      }),
      filetreeInteractionByScope,
    })
    const serialized = JSON.stringify(session)
    const immediateKey = JSON.stringify({
      openRepoEntries: session.openRepoEntries,
      activeRepoId: session.activeRepoId,
      zenMode: session.zenMode,
      workspacePaneSize: session.workspacePaneSize,
      selectedTerminalSessionIdByTerminalWorktree: session.selectedTerminalSessionIdByTerminalWorktree,
      preferredWorkspacePaneTabByBranchByRepo: session.preferredWorkspacePaneTabByBranchByRepo,
      workspacePaneTabsByBranchByRepo: session.workspacePaneTabsByBranchByRepo,
    })
    const immediate = lastImmediateKeyRef.current !== immediateKey
    lastImmediateKeyRef.current = immediateKey
    if (lastSavedRef.current === serialized) return
    const save = () => {
      lastSavedRef.current = serialized
      void persistWorkspaceSessionState(session).catch((err) => {
        lastSavedRef.current = null
        sessionLog.warn('save failed', { err })
      })
    }
    if (immediate) {
      save()
      return
    }
    const timeout = window.setTimeout(save, SESSION_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [
    sessionReady,
    sessionPersistenceReady,
    order,
    activeId,
    workspacePaneSize,
    zenMode,
    selectedTerminalSessionIdByTerminalWorktree,
    repos,
    workspacePaneTabsVersion,
    filetreeInteractionByScope,
  ])
}

function useWorkspacePaneTabsCacheVersion(): number {
  return useSyncExternalStore(subscribeWorkspacePaneTabsCache, workspacePaneTabsCacheSnapshot)
}

function subscribeWorkspacePaneTabsCache(onStoreChange: () => void): () => void {
  return primaryWindowQueryClient.getQueryCache().subscribe((event) => {
    if (!event?.query || !isWorkspacePaneTabsQueryKey(event.query.queryKey)) return
    workspacePaneTabsCacheVersion += 1
    onStoreChange()
  })
}

function workspacePaneTabsCacheSnapshot(): number {
  return workspacePaneTabsCacheVersion
}
