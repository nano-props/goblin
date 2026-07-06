// Authenticated bootstrap primes query state from the server transport before
// feature stores start reading it.
import { useEffect, useRef, useState } from 'react'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { restoreFiletreeViewStateFromSession } from '#/web/filetree-session-state.ts'
import { restoreRestorableWorkspaceStateFromSession } from '#/web/restorable-workspace-state.ts'
import { getExternalAppsSnapshot, getSettingsSnapshot } from '#/web/settings-client.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useSessionRestoreStore } from '#/web/stores/session-restore.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import {
  restoreServerWorkspacePaneTabsFromSession,
  type RestoreWorkspacePaneTabsFromSessionResult,
} from '#/web/workspace-pane/workspace-pane-session-tabs-restore.ts'
import { createTimeoutAbortController } from '#/web/lib/abort.ts'

export type AuthenticatedAppBootstrapState = { status: 'restoring-workspace' } | { status: 'ready' }

const RESTORING_WORKSPACE_BOOTSTRAP_STATE: AuthenticatedAppBootstrapState = { status: 'restoring-workspace' }
const READY_BOOTSTRAP_STATE: AuthenticatedAppBootstrapState = { status: 'ready' }

const AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS = 30_000
const AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED = new Error('authenticated workspace restore cancelled')

interface AuthenticatedWorkspaceRestoreRun {
  cancel: () => void
}

type WorkspaceRestoreOutcome = { status: 'completed' } | { status: 'cancelled' }
type WorkspaceRestoreCancellationKind = 'cleanup' | 'failure'

export function useAuthenticatedAppBootstrap(): AuthenticatedAppBootstrapState {
  const restoreRunRef = useRef<AuthenticatedWorkspaceRestoreRun | null>(null)
  const [state, setState] = useState<AuthenticatedAppBootstrapState>(RESTORING_WORKSPACE_BOOTSTRAP_STATE)

  useEffect(() => {
    if (restoreRunRef.current) return
    const run = startAuthenticatedWorkspaceRestoreRun(() => setState(READY_BOOTSTRAP_STATE))
    restoreRunRef.current = run
    return () => {
      run.cancel()
      if (restoreRunRef.current === run) restoreRunRef.current = null
    }
  }, [])

  return state
}

function startAuthenticatedWorkspaceRestoreRun(onReady: () => void): AuthenticatedWorkspaceRestoreRun {
  let cancelled = false
  const timeout = createTimeoutAbortController(
    AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS,
    `authenticated workspace restore timed out after ${AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS}ms`,
  )
  // One settings read fans out to cache priming, theme, and session restore.
  // Promise.resolve() converts synchronous configuration failures into the same
  // async failure channel as fetch errors, so restoreBootSession owns the result.
  const settingsSnapshot = Promise.resolve().then(() => getSettingsSnapshot({ signal: timeout.signal }))
  void primeSettingsQueryCache(settingsSnapshot, timeout.signal).catch((err) => {
    if (!timeout.signal.aborted) bootstrapLog.warn('settings priming failed', { err })
  })
  void hydrateNonCriticalAuthenticatedState(settingsSnapshot, timeout.signal)
  void restoreBootSession(settingsSnapshot, timeout.signal).then((outcome) => {
    timeout.dispose()
    if (!cancelled && outcome.status === 'completed') onReady()
  })
  return {
    cancel: () => {
      cancelled = true
      timeout.abort(AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED)
      timeout.dispose()
    },
  }
}

async function hydrateNonCriticalAuthenticatedState(
  settingsSnapshot: Promise<SettingsSnapshot>,
  signal: AbortSignal,
): Promise<void> {
  await Promise.all([
    runOptionalBootstrapTask(
      'theme hydrate',
      async () => {
        await useThemeStore.getState().hydrateFromSettingsSnapshot(await settingsSnapshot)
      },
      signal,
    ),
    runOptionalBootstrapTask('i18n hydrate', () => useI18nStore.getState().hydrate({ signal }), signal),
    runOptionalBootstrapTask('host-info hydrate', () => useHostInfoStore.getState().hydrate({ signal }), signal),
  ])
}

async function restoreBootSession(
  settingsSnapshot: Promise<SettingsSnapshot>,
  signal: AbortSignal,
): Promise<WorkspaceRestoreOutcome> {
  try {
    useReposStore.setState({ sessionPersistenceReady: false, sessionRestoreError: null })
    useSessionRestoreStore.getState().hydrateFromSettingsSnapshot(await abortable(settingsSnapshot, signal))
    if (signal.aborted) throw abortReason(signal)
    const session = useSessionRestoreStore.getState().consumeBootSessionSnapshot()
    const normalizedLayout = normalizeWorkspaceSessionLayoutState(session)
    const { hydrateRepoSession, applySessionLayoutState, applySessionSelectedTerminalState } = useReposStore.getState()
    // Apply layout prefs before repo probing finishes so the first
    // restored paint uses the saved geometry. useSessionPersistence
    // still waits for workspaceMembershipReady, so this cannot overwrite the
    // persisted session with a partially hydrated one.
    const restoredWorkspaceState = restoreRestorableWorkspaceStateFromSession(session)
    restoreFiletreeViewStateFromSession(session.filetreeViewStateByWorktreeByRepo)
    applySessionLayoutState(normalizedLayout)
    applySessionSelectedTerminalState(restoredWorkspaceState.selectedTerminalSessionIdByTerminalWorktree)
    await abortable(
      hydrateRepoSession(session.openRepoEntries, session.restoredRepoId, {
        signal,
        workspacePaneRestoreState: {
          workspacePaneTabsByTargetByRepo: restoredWorkspaceState.workspacePaneTabsByTargetByRepo,
          preferredWorkspacePaneTabByTargetByRepo: restoredWorkspaceState.preferredWorkspacePaneTabByTargetByRepo,
        },
      }),
      signal,
    )
    if (signal.aborted) throw abortReason(signal)
    const workspaceTabsRestoreResult = await abortable(
      restoreServerWorkspacePaneTabsFromSession(restoredWorkspaceState.workspacePaneTabsByTargetByRepo, {
        signal,
      }),
      signal,
    )

    if (workspaceTabsRestoreResult.status === 'cancelled') {
      if (workspaceRestoreCancellationKind(signal) === 'cleanup') return { status: 'cancelled' }
      throw abortReason(signal)
    }
    finishWorkspacePaneTabsBootRestore(workspaceTabsRestoreResult)
    return { status: 'completed' }
  } catch (err) {
    if (err === AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED) return { status: 'cancelled' }
    bootstrapLog.warn('session restore failed', { err })
    blockSessionPersistenceAfterRestoreFailure(restoreFailureMessage(err))
    return { status: 'completed' }
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal)
  let onAbort: (() => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function finishWorkspacePaneTabsBootRestore(
  result: Exclude<RestoreWorkspacePaneTabsFromSessionResult, { status: 'cancelled' }>,
): void {
  switch (result.status) {
    case 'restored':
      useReposStore.setState({ sessionPersistenceReady: true, sessionRestoreError: null })
      return
    case 'failed':
      bootstrapLog.warn('workspace pane tabs restore failed', workspacePaneTabsRestoreSummary(result))
      blockSessionPersistenceAfterRestoreFailure('workspace pane tabs restore failed')
      return
  }
}

function workspacePaneTabsRestoreSummary(result: RestoreWorkspacePaneTabsFromSessionResult) {
  return {
    unresolvedRepos: result.unresolvedRepos,
    unresolvedTargets: result.unresolvedTargets,
    failedCommitCount: result.failedCommits.length,
  }
}

function blockSessionPersistenceAfterRestoreFailure(message: string): void {
  useReposStore.setState({
    workspaceMembershipReady: true,
    sessionPersistenceReady: false,
    sessionRestoreError: message,
  })
}

function restoreFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'session restore failed'
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new Error('authenticated workspace restore aborted')
}

function workspaceRestoreCancellationKind(signal: AbortSignal): WorkspaceRestoreCancellationKind {
  return signal.reason === AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED ? 'cleanup' : 'failure'
}

function isAbortReason(err: unknown, signal: AbortSignal): boolean {
  if (err === signal.reason) return true
  return err instanceof Error && err.name === 'AbortError'
}

async function runOptionalBootstrapTask(label: string, task: () => Promise<void>, signal: AbortSignal): Promise<void> {
  try {
    await task()
  } catch (err) {
    if (signal.aborted && isAbortReason(err, signal)) return
    bootstrapLog.warn(`${label} failed`, { err })
  }
}

/**
 * Prime the settings and external-apps query cache from the authenticated
 * `/api/settings` + `/api/settings/external-apps` endpoints so the
 * settings pages render with their persisted values on first paint
 * instead of flashing the defaults. Each call sites its own error
 * log on failure - the client's boot must not be blocked by a
 * settings fetch outage.
 */
async function primeSettingsQueryCache(
  settingsSnapshot: Promise<SettingsSnapshot>,
  signal: AbortSignal,
): Promise<void> {
  // `getSettingsSnapshot()` / `getExternalAppsSnapshot()` can throw
  // synchronously when the bootstrap is missing (the request never
  // reaches `fetch`). Wrap each one individually so the other can
  // still succeed and so a synchronous throw doesn't propagate up
  // and abort the rest of the boot.
  const fetchAndPrime = async (
    label: string,
    fetcher: () => Promise<unknown>,
    queryKey: readonly unknown[],
  ): Promise<void> => {
    try {
      const snapshot = await fetcher()
      primaryWindowQueryClient.setQueryData(queryKey, snapshot)
    } catch (err) {
      if (signal.aborted && isAbortReason(err, signal)) return
      // Settings fetch failure must not block boot - the page will
      // retry the auto-fetch on first use. The empty cache is the
      // same state the client had before this priming pass.
      bootstrapLog.warn(`${label} query prime failed`, { err })
    }
  }
  await Promise.all([
    fetchAndPrime('settings snapshot', () => settingsSnapshot, settingsSnapshotQueryKey()),
    fetchAndPrime('external apps', () => getExternalAppsSnapshot({ signal }), externalAppsQueryKey()),
  ])
}
