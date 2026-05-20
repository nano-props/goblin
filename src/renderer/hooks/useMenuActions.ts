import { useEffect } from 'react'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useThemeStore } from '#/renderer/stores/theme.ts'

interface MenuActionHandlers {
  openSettings: () => void
  showHelp: () => void
}

export function useMenuActions({ openSettings, showHelp }: MenuActionHandlers) {
  const refreshAll = useReposStore((s) => s.refreshAll)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const cycleActive = useReposStore((s) => s.cycleActive)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const cycleTheme = useThemeStore((s) => s.setPref)

  useEffect(() => {
    const off = window.gbl.onMenuAction(async (action) => {
      const state = useReposStore.getState()
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
          if (state.activeId) await refreshAll(state.activeId)
          break
        case 'tab-status':
          if (state.activeId) setDetailTab(state.activeId, 'status')
          break
        case 'tab-log':
          if (state.activeId) setDetailTab(state.activeId, 'commits')
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
  }, [closeRepo, cycleActive, cycleTheme, openSettings, refreshAll, setDetailTab, showHelp])
}
