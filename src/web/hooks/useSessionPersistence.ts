import { useEffect, useRef, useSyncExternalStore } from 'react'
import { persistWorkspaceSessionState } from '#/web/settings-actions.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { restorableWorkspaceStateFromStore } from '#/web/stores/repos/selector-state.ts'
import { workspaceSessionStateFromRestorableWorkspaceState } from '#/web/restorable-workspace-state.ts'
import { sessionLog } from '#/web/logger.ts'
import { useFiletreeInteractionStore } from '#/web/stores/repos/filetree-interaction-state.ts'
import {
  subscribeWorkspacePaneTabsPersistenceChanges,
  workspacePaneTabsPersistenceSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
const SESSION_SAVE_DEBOUNCE_MS = 200

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
  const queuedSaveRef = useRef<{
    session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState>
    serialized: string
  } | null>(null)
  const saveDrainRef = useRef<Promise<void> | null>(null)

  const enqueueSave = (
    session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState>,
    serialized: string,
  ) => {
    queuedSaveRef.current = { session, serialized }
    if (saveDrainRef.current) return
    saveDrainRef.current = (async () => {
      while (queuedSaveRef.current) {
        const next = queuedSaveRef.current
        queuedSaveRef.current = null
        lastSavedRef.current = next.serialized
        try {
          await persistWorkspaceSessionState(next.session)
        } catch (err) {
          if (lastSavedRef.current === next.serialized) lastSavedRef.current = null
          sessionLog.warn('save failed', { err })
        }
      }
    })().finally(() => {
      saveDrainRef.current = null
      if (queuedSaveRef.current) enqueueSave(queuedSaveRef.current.session, queuedSaveRef.current.serialized)
    })
  }

  useEffect(() => {
    // Client -> persistence only. Boot restore runs elsewhere first. sessionReady
    // gates the UI skeleton; sessionPersistenceReady waits for boot-restored
    // server-owned workspace tabs to converge back into the client store.
    if (!sessionReady || !sessionPersistenceReady) return
    let session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState>
    try {
      session = workspaceSessionStateFromRestorableWorkspaceState({
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
    } catch (err) {
      sessionLog.warn('save blocked', { err })
      return
    }
    const serialized = JSON.stringify(session)
    // Restorable session writes should be immediate only for coarse
    // workspace-structure changes. High-frequency runtime churn such as
    // terminal selection and workspace-tab mutation is still restorable, but
    // it should batch through the debounce path instead of competing with
    // server-owned runtime traffic one write at a time.
    const immediateKey = JSON.stringify({
      openRepoEntries: session.openRepoEntries,
      activeRepoId: session.activeRepoId,
      zenMode: session.zenMode,
      workspacePaneSize: session.workspacePaneSize,
    })
    const immediate = lastImmediateKeyRef.current !== immediateKey
    lastImmediateKeyRef.current = immediateKey
    if (lastSavedRef.current === serialized) return
    const save = () => enqueueSave(session, serialized)
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
  return useSyncExternalStore(subscribeWorkspacePaneTabsPersistenceChanges, workspacePaneTabsPersistenceSnapshot)
}
