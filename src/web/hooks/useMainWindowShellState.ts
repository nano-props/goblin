import { useCallback, useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { createMainWindowNavigationActions } from '#/web/main-window-navigation-actions.ts'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  mainWindowNavigationStoreActionsEqual,
  mainWindowNavigationStoreActionsFromStore,
} from '#/web/stores/repos/selector-actions.ts'
import { mainWindowWorkspaceStateEqual, mainWindowWorkspaceStateFromStore } from '#/web/stores/repos/selector-state.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

interface UseMainWindowShellStateOptions {
  routeSettingsPage?: SettingsPage | null
  onRouteSettingsPageChange?: (page: SettingsPage | null) => void
}

export function useMainWindowShellState({
  routeSettingsPage = null,
  onRouteSettingsPageChange,
}: UseMainWindowShellStateOptions) {
  const uiMode = useResponsiveUiMode()
  const { activeId, sessionReady, detailCollapsed, detailFocusMode, workspaceLayout, order } = useStoreWithEqualityFn(
    useReposStore,
    mainWindowWorkspaceStateFromStore,
    mainWindowWorkspaceStateEqual,
  )
  const { setActive, closeRepo, cycleActive, selectBranch, setDetailTab } = useStoreWithEqualityFn(
    useReposStore,
    mainWindowNavigationStoreActionsFromStore,
    mainWindowNavigationStoreActionsEqual,
  )
  const overlays = useAppOverlays()
  const workspaceBehavior = repoWorkspaceBehavior(workspaceLayout, detailCollapsed, detailFocusMode)
  const visibleRepoId = activeId
  const settingsOpen = routeSettingsPage !== null
  const modalOpen = overlays.anyOpen
  const workspaceShortcutsSuppressed = modalOpen || settingsOpen
  const openSettings = useCallback(
    (page: SettingsPage = 'general') => {
      onRouteSettingsPageChange?.(page)
    },
    [onRouteSettingsPageChange],
  )
  const showHelp = useCallback(() => {
    openSettings('shortcuts')
  }, [openSettings])
  const exitSettings = useCallback(() => {
    onRouteSettingsPageChange?.(null)
  }, [onRouteSettingsPageChange])
  const navigation = useMemo(
    () =>
      createMainWindowNavigationActions({
        activeId,
        order,
        setActive,
        closeRepo,
        cycleActive,
        selectBranch,
        setDetailTab,
        onOpenSettings: openSettings,
      }),
    [
      activeId,
      closeRepo,
      cycleActive,
      openSettings,
      order,
      selectBranch,
      setActive,
      setDetailTab,
    ],
  )

  return {
    overlays,
    sessionReady,
    visibleRepoId,
    workspaceLayout,
    workspaceBehavior,
    settingsOpen,
    modalOpen,
    workspaceShortcutsSuppressed,
    openSettings,
    showHelp,
    exitSettings,
    navigation,
  }
}
