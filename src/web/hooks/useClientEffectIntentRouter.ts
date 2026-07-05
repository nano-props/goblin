import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useReposStore } from '#/web/stores/repos/store.ts'
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
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { clientEffectIntentStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'

interface ClientEffectIntentRouterOptions {
  navigation: PrimaryWindowNavigationActions
  currentRepoId: string | null
  currentBranchName?: string | null
  closeAllOverlays: () => void
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  openCreateWorktree: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
}

export function useClientEffectIntentRouter({
  navigation,
  currentRepoId,
  currentBranchName = null,
  closeAllOverlays,
  openRepoPathDialog,
  openCloneRepo,
  openRemoteRepo,
  openCreateWorktree,
  isOverlayOpen,
  isWorkspaceShortcutSuppressed,
}: ClientEffectIntentRouterOptions) {
  // This hook is the single client-side subscription point for native effect
  // intents. Routing stays centralized here; intent-specific behavior lives in
  // the handler/plan helpers so components do not subscribe independently.
  const { ensureWorkspaceOpen, setSelectedTerminal, resetLayout, toggleZenMode } = useReposStore(
    useShallow(clientEffectIntentStoreActionsFromStore),
  )
  const t = useT()
  const navigationRef = useRef(navigation)
  const currentRepoIdRef = useRef(currentRepoId)
  const currentBranchNameRef = useRef(currentBranchName)
  const isOverlayOpenRef = useRef(isOverlayOpen)
  const isWorkspaceShortcutSuppressedRef = useRef(isWorkspaceShortcutSuppressed)
  const tRef = useRef(t)
  const ensureWorkspaceOpenRef = useRef(ensureWorkspaceOpen)
  navigationRef.current = navigation
  currentRepoIdRef.current = currentRepoId
  currentBranchNameRef.current = currentBranchName
  isOverlayOpenRef.current = isOverlayOpen
  isWorkspaceShortcutSuppressedRef.current = isWorkspaceShortcutSuppressed
  tRef.current = t
  ensureWorkspaceOpenRef.current = ensureWorkspaceOpen

  useEffect(() => {
    const externalOpenDrainer = createExternalOpenIntentDrainer({
      ensureWorkspaceOpen: async (path) => await ensureWorkspaceOpenRef.current(path),
      activateRepo: (repoId) => navigationRef.current.activateRepo(repoId),
      t: (key) => tRef.current(key),
    })
    let disposed = false
    let intentQueue = Promise.resolve()

    const sharedDeps = () => ({
      navigation: navigationRef.current,
      currentRepoId: currentRepoIdRef.current,
      currentBranchName: currentBranchNameRef.current,
      closeAllOverlays,
      openRepoPathDialog,
      openCloneRepo,
      openRemoteRepo,
      openCreateWorktree,
      isOverlayOpen: () => isOverlayOpenRef.current(),
      isWorkspaceShortcutSuppressed: () => isWorkspaceShortcutSuppressedRef.current(),
      ensureWorkspaceOpen: async (input: string | RepoSessionEntry) => await ensureWorkspaceOpenRef.current(input),
      setSelectedTerminal,
      resetLayout,
      toggleZenMode,
      t: (key: string) => tRef.current(key),
    })

    // One dispatch closure fed by both ingresses. Adding a new
    // producer (Electron IPC, server WS, future transports) is a
    // one-line `subscribe*(dispatch)` below — no copy of the
    // switch / handler chain.
    const dispatch = (intent: ClientEffectIntent) => {
      intentQueue = intentQueue.catch(() => undefined).then(async () => {
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
  }, [
    closeAllOverlays,
    navigation,
    currentRepoId,
    isOverlayOpen,
    isWorkspaceShortcutSuppressed,
    ensureWorkspaceOpen,
    openCloneRepo,
    openRemoteRepo,
    openCreateWorktree,
    openRepoPathDialog,
    resetLayout,
    setSelectedTerminal,
    toggleZenMode,
    t,
  ])
}
