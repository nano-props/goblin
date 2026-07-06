import { useEffect, useEffectEvent, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { persistWorkspaceSessionState, persistWorkspaceSessionStateOnUnload } from '#/web/settings-actions.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  restorableWorkspaceStateFromStore,
  workspaceSessionPersistenceOpenFromStore,
} from '#/web/stores/repos/selector-state.ts'
import { workspaceSessionStateFromRestorableWorkspaceState } from '#/web/restorable-workspace-state.ts'
import { sessionLog } from '#/web/logger.ts'
import { useFiletreeInteractionStore } from '#/web/stores/repos/filetree-interaction-state.ts'
import {
  subscribeWorkspacePaneTabsPersistenceChanges,
  workspacePaneTabsPersistenceSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { subscribeAppQuitting } from '#/web/app-lifecycle.ts'
const SESSION_SAVE_DEBOUNCE_MS = 200

interface SessionPersistenceInput {
  workspaceMembershipReady: boolean
  sessionPersistenceReady: boolean
  sessionRestoreError: string | null
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
  const sessionRestoreError = useReposStore((s) => s.sessionRestoreError)
  const repos = useReposStore((s) => s.repos)
  const workspacePaneTabsVersion = useWorkspacePaneTabsCacheVersion()
  const filetreeInteractionByScope = useFiletreeInteractionStore((s) => s.interactionByScope)
  const lastSavedRef = useRef<string | null>(null)
  const lastImmediateKeyRef = useRef<string | null>(null)
  const lastRoutedRepoIdRef = useRef<string | null>(null)
  const queuedSaveRef = useRef<{
    session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState>
    serialized: string
  } | null>(null)
  const latestSaveRef = useRef<{
    session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState>
    serialized: string
  } | null>(null)
  const saveDrainRef = useRef<Promise<void> | null>(null)
  const debounceTimerRef = useRef<number | null>(null)
  const lastSaveErrorRef = useRef<unknown>(null)

  const enqueueSave = (
    session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState>,
    serialized: string,
    options?: { throwOnFailure?: boolean },
  ) => {
    lastSaveErrorRef.current = null
    queuedSaveRef.current = { session, serialized }
    if (saveDrainRef.current) {
      return options?.throwOnFailure
        ? saveDrainRef.current.then(() => {
            if (lastSaveErrorRef.current) throw lastSaveErrorRef.current
          })
        : saveDrainRef.current
    }
    saveDrainRef.current = (async () => {
      while (queuedSaveRef.current) {
        const next = queuedSaveRef.current
        queuedSaveRef.current = null
        lastSavedRef.current = next.serialized
        try {
          await persistWorkspaceSessionState(next.session)
          lastSaveErrorRef.current = null
        } catch (err) {
          if (lastSavedRef.current === next.serialized) lastSavedRef.current = null
          lastSaveErrorRef.current = err
          sessionLog.warn('save failed', { err })
          if (options?.throwOnFailure) throw err
        }
      }
    })().finally(() => {
      saveDrainRef.current = null
      if (queuedSaveRef.current) enqueueSave(queuedSaveRef.current.session, queuedSaveRef.current.serialized)
    })
    return saveDrainRef.current
  }

  const latestSessionSaveCandidate = useEffectEvent(() => {
    const session = sessionFromPersistenceInput(
      {
        workspaceMembershipReady,
        sessionPersistenceReady,
        sessionRestoreError,
        repos,
        order,
        restoredRepoId,
        zenMode,
        workspacePaneSize,
        selectedTerminalSessionIdByTerminalWorktree,
        filetreeInteractionByScope,
      },
      routedRepoId ?? lastRoutedRepoIdRef.current,
    )
    if (!session) return null
    return { session, serialized: JSON.stringify(session) }
  })

  const drainNativeQuitPersistenceBoundary = useEffectEvent(async () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const latest = latestSessionSaveCandidate()
    if (!latest) return
    latestSaveRef.current = latest
    if (lastSavedRef.current === latest.serialized) return
    await enqueueSave(latest.session, latest.serialized, { throwOnFailure: true })
  })

  useLayoutEffect(() => {
    if (routedRepoId) lastRoutedRepoIdRef.current = routedRepoId
  }, [routedRepoId])

  useEffect(() => {
    return subscribeAppQuitting(drainNativeQuitPersistenceBoundary)
  }, [])

  useEffect(() => {
    // Client -> persistence only. Boot restore runs elsewhere first.
    // workspaceMembershipReady gates the UI skeleton; sessionPersistenceReady waits
    // for boot-restored server-owned workspace tabs to converge back into the client store.
    let latest: ReturnType<typeof latestSessionSaveCandidate>
    try {
      latest = latestSessionSaveCandidate()
      if (!latest) return
    } catch (err) {
      sessionLog.warn('save blocked', { err })
      return
    }
    const { session, serialized } = latest
    latestSaveRef.current = latest
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
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      save()
    }, SESSION_SAVE_DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [
    workspaceMembershipReady,
    sessionPersistenceReady,
    sessionRestoreError,
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
        const latest = latestSessionSaveCandidate()
        if (latest) persistWorkspaceSessionStateOnUnload(latest.session)
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
  if (!input || !workspaceSessionPersistenceOpenFromStore(input)) return null
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
