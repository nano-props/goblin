import { useEffect, useRef } from 'react'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { restoreRestorableWorkspaceStateFromSession } from '#/web/restorable-workspace-state.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useSessionRestoreStore } from '#/web/stores/session-restore.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { bootstrapLog } from '#/web/logger.ts'
export function useAppBootstrap() {
  const hydratedRef = useRef(false)

  useEffect(() => {
    // Boot-only restore path. This consumes the one-shot session snapshot and
    // applies it into the repos store before runtime persistence starts; it
    // does not establish a live session <-> renderer sync loop.
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
          useSessionRestoreStore.getState().hydrate(),
          useI18nStore.getState().hydrate(),
        ])
        const session = useSessionRestoreStore.getState().consumeBootSessionSnapshot()
        const normalizedLayout = normalizeWorkspaceSessionLayoutState(session)
        const {
          hydrateSession,
          applySessionLayoutState,
          applySessionSelectedTerminalState,
          applySessionDetailTabByRepo,
        } = useReposStore.getState()
        // Apply layout prefs before repo probing finishes so the first
        // restored paint uses the saved geometry. useSessionPersistence
        // still waits for sessionReady, so this cannot overwrite the
        // persisted session with a partially hydrated one.
        const restoredWorkspaceState = restoreRestorableWorkspaceStateFromSession(session)
        applySessionLayoutState(normalizedLayout)
        applySessionSelectedTerminalState(restoredWorkspaceState.selectedTerminalByWorktree)
        await hydrateSession(session.openRepos, session.activeRepo)
        applySessionDetailTabByRepo(restoredWorkspaceState.detailTabByRepo)
      } catch (err) {
        bootstrapLog.warn('failed', { err })
        useReposStore.setState({ sessionReady: true })
      }
    })()
  }, [])
}
