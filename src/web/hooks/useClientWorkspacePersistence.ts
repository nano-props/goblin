import { useEffect, useEffectEvent, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import { writeClientWorkspaceState } from '#/web/client-workspace-state.ts'
import { subscribeAppQuitting } from '#/web/app-lifecycle.ts'
import { sessionLog } from '#/web/logger.ts'
import { clientWorkspaceStateFromRestorableWorkspaceState } from '#/web/restorable-workspace-state.ts'
import { useFiletreeInteractionStore } from '#/web/stores/workspaces/filetree-interaction-state.ts'
import {
  restorableWorkspaceStateFromStore,
  workspaceSessionPersistenceOpenFromStore,
} from '#/web/stores/workspaces/selector-state.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  subscribeWorkspacePaneTabsPersistenceChanges,
  workspacePaneTabsPersistenceSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const CLIENT_WORKSPACE_SAVE_DEBOUNCE_MS = 200

interface ClientWorkspacePersistenceInput {
  workspaceMembershipReady: boolean
  sessionPersistenceReady: boolean
  sessionRestoreError: string | null
  restoredClientWorkspaceBaseline: ReturnType<typeof useWorkspacesStore.getState>['restoredClientWorkspaceBaseline']
  workspaces: ReturnType<typeof useWorkspacesStore.getState>['workspaces']
  workspaceOrder: WorkspaceId[]
  restoredWorkspaceId: WorkspaceId | null
  zenMode: boolean
  workspacePaneSize: number
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>
  filetreeInteractionByScope: Parameters<
    typeof clientWorkspaceStateFromRestorableWorkspaceState
  >[0]['filetreeInteractionByScope']
}

export function useClientWorkspacePersistence({ routedRepoId }: { routedRepoId: string | null }) {
  const restoredWorkspaceId = useWorkspacesStore((s) => s.restoredWorkspaceId)
  const workspaceOrder = useWorkspacesStore((s) => s.workspaceOrder)
  const zenMode = useWorkspacesStore((s) => s.zenMode)
  const workspacePaneSize = useWorkspacesStore((s) => s.workspacePaneSize)
  const selectedTerminalSessionIdByTerminalWorktree = useWorkspacesStore(
    (s) => s.selectedTerminalSessionIdByTerminalWorktree,
  )
  const workspaceMembershipReady = useWorkspacesStore((s) => s.workspaceMembershipReady)
  const sessionPersistenceReady = useWorkspacesStore((s) => s.sessionPersistenceReady)
  const sessionRestoreError = useWorkspacesStore((s) => s.sessionRestoreError)
  const restoredClientWorkspaceBaseline = useWorkspacesStore((s) => s.restoredClientWorkspaceBaseline)
  const workspaces = useWorkspacesStore((s) => s.workspaces)
  const workspacePaneTabsVersion = useWorkspacePaneTabsCacheVersion()
  const filetreeInteractionByScope = useFiletreeInteractionStore((s) => s.interactionByScope)
  const lastImmediateKeyRef = useRef<string | null>(null)
  const lastRoutedWorkspaceIdRef = useRef<WorkspaceId | null>(null)
  const debounceTimerRef = useRef<number | null>(null)

  const latestClientWorkspace = useEffectEvent(() =>
    clientWorkspaceFromPersistenceInput(
      {
        workspaceMembershipReady,
        sessionPersistenceReady,
        sessionRestoreError,
        restoredClientWorkspaceBaseline,
        workspaces,
        workspaceOrder,
        restoredWorkspaceId,
        zenMode,
        workspacePaneSize,
        selectedTerminalSessionIdByTerminalWorktree,
        filetreeInteractionByScope,
      },
      (routedRepoId ? workspaces[routedRepoId]?.id : null) ?? lastRoutedWorkspaceIdRef.current,
    ),
  )

  const flushLatestClientWorkspace = useEffectEvent(async () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const workspace = latestClientWorkspace()
    if (!workspace) return
    await writeClientWorkspaceState(workspace)
  })

  const flushClientWorkspaceInBackground = useEffectEvent(() => {
    void flushLatestClientWorkspace().catch(() => {})
  })

  useLayoutEffect(() => {
    const routedWorkspaceId = routedRepoId ? workspaces[routedRepoId]?.id : null
    if (routedWorkspaceId) lastRoutedWorkspaceIdRef.current = routedWorkspaceId
  }, [routedRepoId, workspaces])

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
      restoredWorkspaceId: workspace.restoredWorkspaceId,
      zenMode: workspace.zenMode,
      workspacePaneSize: workspace.workspacePaneSize,
    })
    const immediate = immediateKey !== lastImmediateKeyRef.current
    lastImmediateKeyRef.current = immediateKey
    if (immediate) {
      flushClientWorkspaceInBackground()
      return
    }
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = window.setTimeout(flushClientWorkspaceInBackground, CLIENT_WORKSPACE_SAVE_DEBOUNCE_MS)
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
    workspaceOrder,
    restoredWorkspaceId,
    restoredClientWorkspaceBaseline,
    routedRepoId,
    workspacePaneSize,
    zenMode,
    selectedTerminalSessionIdByTerminalWorktree,
    workspaces,
    workspacePaneTabsVersion,
    filetreeInteractionByScope,
  ])

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushClientWorkspaceInBackground()
    }
    window.addEventListener('pagehide', flushClientWorkspaceInBackground)
    window.addEventListener('beforeunload', flushClientWorkspaceInBackground)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushClientWorkspaceInBackground)
      window.removeEventListener('beforeunload', flushClientWorkspaceInBackground)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [])
}

function clientWorkspaceFromPersistenceInput(
  input: ClientWorkspacePersistenceInput,
  lastRoutedRepoId: WorkspaceId | null,
): ClientWorkspaceState | null {
  if (!workspaceSessionPersistenceOpenFromStore(input)) return null
  return clientWorkspaceStateFromRestorableWorkspaceState({
    workspaces: input.workspaces,
    restorableWorkspaceState: restorableWorkspaceStateFromStore({
      workspaceOrder: input.workspaceOrder,
      restoredWorkspaceId: lastRoutedRepoId ?? input.restoredWorkspaceId,
      zenMode: input.zenMode,
      workspacePaneSize: input.workspacePaneSize,
      selectedTerminalSessionIdByTerminalWorktree: input.selectedTerminalSessionIdByTerminalWorktree,
    }),
    filetreeInteractionByScope: input.filetreeInteractionByScope,
    restoredClientWorkspaceBaseline: input.restoredClientWorkspaceBaseline,
  })
}

function useWorkspacePaneTabsCacheVersion(): number {
  return useSyncExternalStore(subscribeWorkspacePaneTabsPersistenceChanges, workspacePaneTabsPersistenceSnapshot)
}
