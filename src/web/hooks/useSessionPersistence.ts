import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { persistWorkspaceSessionState, persistWorkspaceSessionStateOnUnload } from '#/web/settings-actions.ts'
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

interface SessionPersistenceInput {
  workspaceMembershipReady: boolean
  sessionPersistenceReady: boolean
  repos: ReturnType<typeof useReposStore.getState>['repos']
  order: string[]
  restoredRepoId: string | null
  zenMode: boolean
  workspacePaneSize: number
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>
  filetreeInteractionByScope: Parameters<typeof workspaceSessionStateFromRestorableWorkspaceState>[0]['filetreeInteractionByScope']
}

export function useSessionPersistence({ routedRepoId }: { routedRepoId: string | null }) {
  const restoredRepoId = useReposStore((s) => s.restoredRepoId)
  const order = useReposStore((s) => s.order)
  const zenMode = useReposStore((s) => s.zenMode)
  const workspacePaneSize = useReposStore((s) => s.workspacePaneSize)
  const selectedTerminalSessionIdByTerminalWorktree = useReposStore(
    (s) => s.selectedTerminalSessionIdByTerminalWorktree,
  )
  const workspaceMembershipReady = useReposStore((s) => s.workspaceMembershipReady)
  const sessionPersistenceReady = useReposStore((s) => s.sessionPersistenceReady)
  const repos = useReposStore((s) => s.repos)
  const workspacePaneTabsVersion = useWorkspacePaneTabsCacheVersion()
  const filetreeInteractionByScope = useFiletreeInteractionStore((s) => s.interactionByScope)
  const lastSavedRef = useRef<string | null>(null)
  const lastImmediateKeyRef = useRef<string | null>(null)
  const lastRoutedRepoIdRef = useRef<string | null>(null)
  const latestInputRef = useRef<SessionPersistenceInput | null>(null)
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

  useLayoutEffect(() => {
    if (routedRepoId) lastRoutedRepoIdRef.current = routedRepoId
    latestInputRef.current = {
      workspaceMembershipReady,
      sessionPersistenceReady,
      repos,
      order,
      restoredRepoId,
      zenMode,
      workspacePaneSize,
      selectedTerminalSessionIdByTerminalWorktree,
      filetreeInteractionByScope,
    }
  }, [
    restoredRepoId,
    filetreeInteractionByScope,
    order,
    repos,
    routedRepoId,
    selectedTerminalSessionIdByTerminalWorktree,
    sessionPersistenceReady,
    workspaceMembershipReady,
    workspacePaneSize,
    zenMode,
  ])

  useEffect(() => {
    // Client -> persistence only. Boot restore runs elsewhere first.
    // workspaceMembershipReady gates the UI skeleton; sessionPersistenceReady waits
    // for boot-restored server-owned workspace tabs to converge back into the client store.
    let session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState> | null
    try {
      session = sessionFromPersistenceInput(latestInputRef.current, lastRoutedRepoIdRef.current)
      if (!session) return
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
      restoredRepoId: session.restoredRepoId,
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
    workspaceMembershipReady,
    sessionPersistenceReady,
    order,
    restoredRepoId,
    routedRepoId,
    workspacePaneSize,
    zenMode,
    selectedTerminalSessionIdByTerminalWorktree,
    repos,
    workspacePaneTabsVersion,
    filetreeInteractionByScope,
  ])

  useEffect(() => {
    const flushLatestSession = () => {
      try {
        const session = sessionFromPersistenceInput(latestInputRef.current, lastRoutedRepoIdRef.current)
        if (session) persistWorkspaceSessionStateOnUnload(session)
      } catch (err) {
        sessionLog.warn('unload save blocked', { err })
      }
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushLatestSession()
    }
    window.addEventListener('pagehide', flushLatestSession)
    window.addEventListener('beforeunload', flushLatestSession)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushLatestSession)
      window.removeEventListener('beforeunload', flushLatestSession)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [])
}

function sessionFromPersistenceInput(
  input: SessionPersistenceInput | null,
  lastRoutedRepoId: string | null,
): ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState> | null {
  if (!input?.workspaceMembershipReady || !input.sessionPersistenceReady) return null
  return workspaceSessionStateFromRestorableWorkspaceState({
    repos: input.repos,
    restorableWorkspaceState: restorableWorkspaceStateFromStore({
      order: input.order,
      restoredRepoId: lastRoutedRepoId ?? input.restoredRepoId,
      zenMode: input.zenMode,
      workspacePaneSize: input.workspacePaneSize,
      selectedTerminalSessionIdByTerminalWorktree: input.selectedTerminalSessionIdByTerminalWorktree,
    }),
    filetreeInteractionByScope: input.filetreeInteractionByScope,
  })
}

function useWorkspacePaneTabsCacheVersion(): number {
  return useSyncExternalStore(subscribeWorkspacePaneTabsPersistenceChanges, workspacePaneTabsPersistenceSnapshot)
}
