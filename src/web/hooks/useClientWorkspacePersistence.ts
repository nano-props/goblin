import { useEffect, useEffectEvent, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import { writeClientWorkspaceState } from '#/web/client-workspace-state.ts'
import { subscribeAppQuitting } from '#/web/app-lifecycle.ts'
import { sessionLog } from '#/web/logger.ts'
import { workspaceSessionStateFromRestorableWorkspaceState } from '#/web/restorable-workspace-state.ts'
import { useFiletreeInteractionStore } from '#/web/stores/repos/filetree-interaction-state.ts'
import {
  restorableWorkspaceStateFromStore,
  workspaceSessionPersistenceOpenFromStore,
} from '#/web/stores/repos/selector-state.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  subscribeWorkspacePaneTabsPersistenceChanges,
  workspacePaneTabsPersistenceSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

const CLIENT_WORKSPACE_SAVE_DEBOUNCE_MS = 200

interface ClientWorkspacePersistenceInput {
  workspaceMembershipReady: boolean
  sessionPersistenceReady: boolean
  sessionRestoreError: string | null
  restoredSessionBaseline: ReturnType<typeof useReposStore.getState>['restoredSessionBaseline']
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

export function useClientWorkspacePersistence({ routedRepoId }: { routedRepoId: string | null }) {
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
  const restoredSessionBaseline = useReposStore((s) => s.restoredSessionBaseline)
  const repos = useReposStore((s) => s.repos)
  const workspacePaneTabsVersion = useWorkspacePaneTabsCacheVersion()
  const filetreeInteractionByScope = useFiletreeInteractionStore((s) => s.interactionByScope)
  const lastImmediateKeyRef = useRef<string | null>(null)
  const lastRoutedRepoIdRef = useRef<string | null>(null)
  const lastSavedRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<number | null>(null)

  const latestClientWorkspace = useEffectEvent(() =>
    clientWorkspaceFromPersistenceInput(
      {
        workspaceMembershipReady,
        sessionPersistenceReady,
        sessionRestoreError,
        restoredSessionBaseline,
        repos,
        order,
        restoredRepoId,
        zenMode,
        workspacePaneSize,
        selectedTerminalSessionIdByTerminalWorktree,
        filetreeInteractionByScope,
      },
      routedRepoId ?? lastRoutedRepoIdRef.current,
    ),
  )

  const flushLatestClientWorkspace = useEffectEvent(async () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const workspace = latestClientWorkspace()
    if (!workspace) return
    const serialized = JSON.stringify(workspace)
    if (serialized === lastSavedRef.current) return
    await writeClientWorkspaceState(workspace)
    lastSavedRef.current = serialized
  })

  useLayoutEffect(() => {
    if (routedRepoId) lastRoutedRepoIdRef.current = routedRepoId
  }, [routedRepoId])

  useEffect(() => subscribeAppQuitting(flushLatestClientWorkspace), [])

  useEffect(() => {
    let workspace: ClientWorkspaceState | null
    try {
      workspace = latestClientWorkspace()
    } catch (err) {
      sessionLog.warn('local workspace save blocked', { err })
      return
    }
    if (!workspace) return
    const immediateKey = JSON.stringify({
      restoredRepoId: workspace.restoredRepoId,
      zenMode: workspace.zenMode,
      workspacePaneSize: workspace.workspacePaneSize,
    })
    const immediate = immediateKey !== lastImmediateKeyRef.current
    lastImmediateKeyRef.current = immediateKey
    if (immediate) {
      void flushLatestClientWorkspace()
      return
    }
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = window.setTimeout(
      () => void flushLatestClientWorkspace(),
      CLIENT_WORKSPACE_SAVE_DEBOUNCE_MS,
    )
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
    restoredSessionBaseline,
    routedRepoId,
    workspacePaneSize,
    zenMode,
    selectedTerminalSessionIdByTerminalWorktree,
    repos,
    workspacePaneTabsVersion,
    filetreeInteractionByScope,
  ])

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void flushLatestClientWorkspace()
    }
    window.addEventListener('pagehide', flushLatestClientWorkspace)
    window.addEventListener('beforeunload', flushLatestClientWorkspace)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushLatestClientWorkspace)
      window.removeEventListener('beforeunload', flushLatestClientWorkspace)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [])
}

function clientWorkspaceFromPersistenceInput(
  input: ClientWorkspacePersistenceInput,
  lastRoutedRepoId: string | null,
): ClientWorkspaceState | null {
  if (!workspaceSessionPersistenceOpenFromStore(input)) return null
  const session = workspaceSessionStateFromRestorableWorkspaceState({
    repos: input.repos,
    restorableWorkspaceState: restorableWorkspaceStateFromStore({
      order: input.order,
      restoredRepoId: lastRoutedRepoId ?? input.restoredRepoId,
      zenMode: input.zenMode,
      workspacePaneSize: input.workspacePaneSize,
      selectedTerminalSessionIdByTerminalWorktree: input.selectedTerminalSessionIdByTerminalWorktree,
    }),
    filetreeInteractionByScope: input.filetreeInteractionByScope,
    restoredSessionBaseline: input.restoredSessionBaseline,
  })
  return {
    openRepoEntries: session.openRepoEntries,
    restoredRepoId: session.restoredRepoId,
    zenMode: session.zenMode,
    workspacePaneSize: session.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: session.selectedTerminalSessionIdByTerminalWorktree,
    preferredWorkspacePaneTabByTargetByRepo: session.preferredWorkspacePaneTabByTargetByRepo,
    filetreeViewStateByWorktreeByRepo: session.filetreeViewStateByWorktreeByRepo,
  }
}

function useWorkspacePaneTabsCacheVersion(): number {
  return useSyncExternalStore(subscribeWorkspacePaneTabsPersistenceChanges, workspacePaneTabsPersistenceSnapshot)
}
