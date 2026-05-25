import { useEffect, useRef } from 'react'
import { useI18nStore } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useThemeStore } from '#/renderer/stores/theme.ts'

export function useAppBootstrap() {
  const hydratedRef = useRef(false)

  useEffect(() => {
    // StrictMode double-invoke guard: React 19 dev runs every effect
    // mount → cleanup → mount on the same component instance to surface
    // non-idempotent side effects. useRef survives that cycle, so by
    // the second mount this flag is already true and we skip kicking
    // off a duplicate hydrateSession against in-flight probes.
    if (hydratedRef.current) return
    hydratedRef.current = true
    void (async () => {
      try {
        await Promise.all([
          useThemeStore.getState().hydrate(),
          useSettingsStore.getState().hydrate(),
          useI18nStore.getState().hydrate(),
        ])
        const session = useSettingsStore.getState().savedSession
        const { hydrateSession, setDetailCollapsed, setDetailFocusMode, setWorkspaceLayout, setDetailPaneSizes } =
          useReposStore.getState()
        // Apply layout prefs before repo probing finishes so the first
        // restored paint uses the saved geometry. useSessionPersistence
        // still waits for sessionReady, so this cannot overwrite the
        // persisted session with a partially hydrated one.
        setWorkspaceLayout(session.workspaceLayout)
        setDetailFocusMode(session.detailFocusMode)
        setDetailCollapsed(session.detailCollapsed)
        setDetailPaneSizes(session.detailPaneSizes)
        await hydrateSession(session.openRepos, session.activeRepo)
      } catch (err) {
        console.warn('[bootstrap] failed', err)
        useReposStore.setState({ sessionReady: true })
      }
    })()
  }, [])
}
