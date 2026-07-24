import { useEffect, useEffectEvent } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { onClientLocalEventType } from '#/web/local-events.ts'
import { subscribeClientEffectIntent } from '#/web/client-ingress.ts'
import { subscribeServerClientIntentIngress } from '#/web/server-client-intent-ingress.ts'
import { intentLog } from '#/web/logger.ts'
import { useT } from '#/web/stores/i18n.ts'
import {
  createExternalOpenIntentDrainer,
  handleAppLevelClientIntent,
  handleTerminalBellClickIntent,
  handleWorkspaceClientIntent,
} from '#/web/hooks/client-effect-intent-handlers.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { clientEffectIntentStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'

interface ClientEffectIntentRouterOptions {
  navigation: PrimaryWindowNavigationActions
  currentWorkspaceId: WorkspaceId | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  closeAllOverlays: () => void
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  openCreateWorktree: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
}

export function useClientEffectIntentRouter({
  navigation,
  currentWorkspaceId,
  currentWorkspacePaneCommandTarget,
  closeAllOverlays,
  openWorkspacePathDialog,
  openCloneRepo,
  openRemoteWorkspace,
  openCreateWorktree,
  isOverlayOpen,
  isWorkspaceShortcutSuppressed,
}: ClientEffectIntentRouterOptions) {
  // This hook is the single client-side subscription point for native effect
  // intents. Routing stays centralized here; intent-specific behavior lives in
  // the handler/plan helpers so components do not subscribe independently.
  const { ensureWorkspaceOpen, resetLayout, toggleZenMode } = useWorkspacesStore(
    useShallow(clientEffectIntentStoreActionsFromStore),
  )
  const t = useT()
  const readCommittedDeps = useEffectEvent(() => ({
    navigation,
    currentWorkspaceId,
    currentWorkspacePaneCommandTarget,
    closeAllOverlays,
    openWorkspacePathDialog,
    openCloneRepo,
    openRemoteWorkspace,
    openCreateWorktree,
    isOverlayOpen,
    isWorkspaceShortcutSuppressed,
    ensureWorkspaceOpen: async (input: string | WorkspaceSessionEntry) => await ensureWorkspaceOpen(input),
    resetLayout,
    toggleZenMode,
    t: (key: string) => t(key),
  }))

  useEffect(() => {
    const externalOpenDrainer = createExternalOpenIntentDrainer({
      ensureWorkspaceOpen: async (path) => await readCommittedDeps().ensureWorkspaceOpen(path),
      activateWorkspace: (workspaceId) => readCommittedDeps().navigation.activateWorkspace(workspaceId),
      t: (key) => readCommittedDeps().t(key),
    })
    let disposed = false
    let intentQueue = Promise.resolve()

    const sharedDeps = () => {
      return readCommittedDeps()
    }

    // One dispatch closure fed by both ingresses. Adding a new
    // producer (Electron IPC, server WS, future transports) is a
    // one-line `subscribe*(dispatch)` below — no copy of the
    // switch / handler chain.
    const dispatch = (intent: ClientEffectIntent) => {
      intentQueue = intentQueue
        .catch(() => undefined)
        .then(async () => {
          if (disposed) return
          try {
            switch (intent.type) {
              case 'terminal-bell-click':
                handleTerminalBellClickIntent(intent, sharedDeps())
                return
              case 'external-open-enqueued':
                externalOpenDrainer.drain()
                return
            }
            if (await handleAppLevelClientIntent(intent, sharedDeps())) return
            if (await handleWorkspaceClientIntent(intent, sharedDeps())) return
          } catch (err) {
            intentLog.warn(`${intent.type} failed`, { err })
          }
        })
    }

    const offIntent = subscribeClientEffectIntent(dispatch)
    const offServerIntent = subscribeServerClientIntentIngress(dispatch)
    const offLocalBellClick = onClientLocalEventType('terminal-bell-click', (event) => {
      handleTerminalBellClickIntent(event, sharedDeps())
    })

    externalOpenDrainer.drain()

    return () => {
      disposed = true
      externalOpenDrainer.dispose()
      offIntent()
      offServerIntent()
      offLocalBellClick()
    }
    // The ingress sockets and intent queue belong to the mounted application,
    // not to an individual route render. Every changing dependency above is
    // read through the Effect Event so navigation cannot churn the WebSockets
    // or publish values from a render that React did not commit.
  }, [])
}
