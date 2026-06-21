import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { onRendererLocalEventType } from '#/web/local-events.ts'
import { subscribeRendererEffectIntent } from '#/web/renderer-ingress.ts'
import { intentLog } from '#/web/logger.ts'
import { useT } from '#/web/stores/i18n.ts'
import {
  createExternalOpenIntentDrainer,
  handleAppLevelRendererIntent,
  handleTerminalBellClickIntent,
  handleWorkspaceRendererIntent,
} from '#/web/hooks/renderer-effect-intent-handlers.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  rendererEffectIntentStoreActionsEqual,
  rendererEffectIntentStoreActionsFromStore,
} from '#/web/stores/repos/selector-actions.ts'

interface RendererEffectIntentRouterOptions {
  navigation: MainWindowNavigationActions
  currentRepoId: string | null
  closeAllOverlays: () => void
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
}

export function useRendererEffectIntentRouter({
  navigation,
  currentRepoId,
  closeAllOverlays,
  openRepoPathDialog,
  openCloneRepo,
  openRemoteRepo,
  isOverlayOpen,
  isWorkspaceShortcutSuppressed,
}: RendererEffectIntentRouterOptions) {
  // This hook is the single renderer-side subscription point for native effect
  // intents. Routing stays centralized here; intent-specific behavior lives in
  // the handler/plan helpers so components do not subscribe independently.
  const { ensureWorkspaceOpen, setSelectedTerminal, resetLayout, toggleWorkspaceFocused } = useStoreWithEqualityFn(
    useReposStore,
    rendererEffectIntentStoreActionsFromStore,
    rendererEffectIntentStoreActionsEqual,
  )
  const t = useT()
  const navigationRef = useRef(navigation)
  const currentRepoIdRef = useRef(currentRepoId)
  const isOverlayOpenRef = useRef(isOverlayOpen)
  const isWorkspaceShortcutSuppressedRef = useRef(isWorkspaceShortcutSuppressed)
  const tRef = useRef(t)
  const ensureWorkspaceOpenRef = useRef(ensureWorkspaceOpen)
  navigationRef.current = navigation
  currentRepoIdRef.current = currentRepoId
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

    const sharedDeps = () => ({
      navigation: navigationRef.current,
      currentRepoId: currentRepoIdRef.current,
      closeAllOverlays,
      openRepoPathDialog,
      openCloneRepo,
      openRemoteRepo,
      isOverlayOpen: () => isOverlayOpenRef.current(),
      isWorkspaceShortcutSuppressed: () => isWorkspaceShortcutSuppressedRef.current(),
      ensureWorkspaceOpen: async (input: string | RepoSessionEntry) => await ensureWorkspaceOpenRef.current(input),
      setSelectedTerminal,
      resetLayout,
      toggleWorkspaceFocused,
      t: (key: string) => tRef.current(key),
    })

    const offIntent = subscribeRendererEffectIntent((event) => {
      void (async () => {
        try {
          switch (event.type) {
            case 'terminal-bell-click':
              handleTerminalBellClickIntent(event, sharedDeps())
              return
            case 'external-open-enqueued':
              externalOpenDrainer.drain()
              return
          }
          if (await handleAppLevelRendererIntent(event, sharedDeps())) return
          if (await handleWorkspaceRendererIntent(event, sharedDeps())) return
        } catch (err) {
          intentLog.warn(`${event.type} failed`, { err })
        }
      })()
    })
    const offLocalBellClick = onRendererLocalEventType('terminal-bell-click', (event) => {
      handleTerminalBellClickIntent(event, sharedDeps())
    })

    externalOpenDrainer.drain()

    return () => {
      externalOpenDrainer.dispose()
      offIntent()
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
    openRepoPathDialog,
    resetLayout,
    setSelectedTerminal,
    toggleWorkspaceFocused,
    t,
  ])
}
