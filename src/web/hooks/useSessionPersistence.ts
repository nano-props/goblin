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
  filetreeInteractionByScope: Parameters<
    typeof workspaceSessionStateFromRestorableWorkspaceState
  >[0]['filetreeInteractionByScope']
}

type SessionSaveCandidate = {
  session: ReturnType<typeof workspaceSessionStateFromRestorableWorkspaceState>
  serialized: string
}

interface SessionSaveState {
  queued: SessionSaveCandidate | null
  drain: Promise<void> | null
  startedSerialized: string | null
  completedSerialized: string | null
  unloadFlushedSerialized: string | null
  lastError: unknown
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
  const sessionSaveStateRef = useRef<SessionSaveState>({
    queued: null,
    drain: null,
    startedSerialized: null,
    completedSerialized: null,
    unloadFlushedSerialized: null,
    lastError: null,
  })
  const lastImmediateKeyRef = useRef<string | null>(null)
  const lastRoutedRepoIdRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<number | null>(null)

  const enqueueSave = (candidate: SessionSaveCandidate, options?: { throwOnFailure?: boolean }) => {
    const state = sessionSaveStateRef.current
    state.lastError = null
    state.queued = candidate
    if (state.drain) {
      return options?.throwOnFailure
        ? state.drain.then(() => {
            if (state.lastError) throw state.lastError
          })
        : state.drain
    }
    state.drain = (async () => {
      while (state.queued) {
        const next = state.queued
        state.queued = null
        state.startedSerialized = next.serialized
        try {
          await persistWorkspaceSessionState(next.session)
          state.completedSerialized = next.serialized
          state.lastError = null
        } catch (err) {
          if (state.startedSerialized === next.serialized) state.startedSerialized = null
          state.lastError = err
          sessionLog.warn('save failed', { err })
          if (options?.throwOnFailure) throw err
        }
      }
    })().finally(() => {
      state.drain = null
      if (state.queued) enqueueSave(state.queued)
    })
    return state.drain
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
    const state = sessionSaveStateRef.current
    if (state.completedSerialized === latest.serialized) return
    if (state.startedSerialized === latest.serialized && state.drain) {
      await state.drain
      if (state.lastError) throw state.lastError
      return
    }
    await enqueueSave(latest, { throwOnFailure: true })
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
    const state = sessionSaveStateRef.current
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
    if (state.startedSerialized === serialized) return
    const save = () => enqueueSave(latest)
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
        const state = sessionSaveStateRef.current
        if (!latest || state.completedSerialized === latest.serialized) return
        if (state.unloadFlushedSerialized === latest.serialized) return
        state.unloadFlushedSerialized = latest.serialized
        // TODO: Add server-side session write ordering/versioning so an older
        // in-flight normal save cannot overwrite this newer unload keepalive flush.
        persistWorkspaceSessionStateOnUnload(latest.session)
      } catch (err) {
        sessionLog.warn('unload save blocked', { err })
      }
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        flushLatestSession()
        return
      }
      sessionSaveStateRef.current.unloadFlushedSerialized = null
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
