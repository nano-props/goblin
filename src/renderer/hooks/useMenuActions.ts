import { useEffect } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useThemeStore } from '#/renderer/stores/theme.ts'

interface MenuActionHandlers {
  openSettings: () => void
  showHelp: () => void
}

export function useMenuActions({ openSettings, showHelp }: MenuActionHandlers) {
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const cycleActive = useReposStore((s) => s.cycleActive)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const toggleDetailCollapsed = useReposStore((s) => s.toggleDetailCollapsed)
  const cycleTheme = useThemeStore((s) => s.setPref)

  useEffect(() => {
    const off = window.gbl.onMenuAction(async (action) => {
      const state = useReposStore.getState()
      if (typeof action === 'object') {
        if (action.type === 'open-recent-repo') await state.openRepo(action.path)
        return
      }
      switch (action) {
        case 'open-repo': {
          const path = await window.gbl.openDialog()
          if (path) await state.openRepo(path)
          break
        }
        case 'close-repo': {
          if (state.activeId) closeRepo(state.activeId)
          break
        }
        case 'next-repo':
          cycleActive(1)
          break
        case 'prev-repo':
          cycleActive(-1)
          break
        case 'refresh':
          if (state.activeId) {
            const repo = state.repos[state.activeId]
            if (repo) await syncAndRefresh(repo.id, { token: repo.instanceToken })
          }
          break
        case 'tab-status':
          if (state.activeId) {
            setDetailTab(state.activeId, 'status')
            setDetailCollapsed(false)
          }
          break
        case 'tab-changes':
          if (state.activeId) {
            setDetailTab(state.activeId, 'changes')
            setDetailCollapsed(false)
          }
          break
        case 'tab-log':
          if (state.activeId) {
            setDetailTab(state.activeId, 'commits')
            setDetailCollapsed(false)
          }
          break
        case 'toggle-detail':
          if (state.activeId && !state.repos[state.activeId]?.openCommit) toggleDetailCollapsed()
          break
        case 'toggle-theme': {
          // Read pref from store, not closure: the menu effect runs once
          // (deps: []) so a captured themePref would go stale after the
          // user changes the theme via the Settings panel.
          const current = useThemeStore.getState().pref
          const next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto'
          await cycleTheme(next)
          break
        }
        case 'open-settings':
          openSettings()
          break
        case 'show-help':
          showHelp()
          break
      }
    })
    return off
  }, [
    closeRepo,
    cycleActive,
    cycleTheme,
    openSettings,
    setDetailCollapsed,
    setDetailTab,
    showHelp,
    syncAndRefresh,
    toggleDetailCollapsed,
  ])
}
