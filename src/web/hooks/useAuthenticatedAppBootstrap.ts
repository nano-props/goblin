// Authenticated bootstrap primes query state from the server transport before
// feature stores start reading it.
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ClientWorkspaceState,
  SettingsSnapshot,
} from '#/shared/api-types.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { restoreFiletreeViewStateFromSession } from '#/web/filetree-session-state.ts'
import { restoreRestorableWorkspaceStateFromSession } from '#/web/restorable-workspace-state.ts'
import { getExternalAppsSnapshot, getSettingsSnapshot } from '#/web/settings-client.ts'
import { restoreWorkspaceAtBoot } from '#/web/settings-actions.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { createTimeoutAbortController } from '#/web/lib/abort.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { readClientWorkspaceState } from '#/web/client-workspace-state.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'

export type AuthenticatedAppBootstrapState =
  | { status: 'restoring-workspace' }
  | { status: 'ready' }
  | { status: 'failed'; message: string }

export interface AuthenticatedAppBootstrapResult {
  state: AuthenticatedAppBootstrapState
  retry: () => void
}

const RESTORING_WORKSPACE_BOOTSTRAP_STATE: AuthenticatedAppBootstrapState = { status: 'restoring-workspace' }
const READY_BOOTSTRAP_STATE: AuthenticatedAppBootstrapState = { status: 'ready' }

const AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS = 30_000
const AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED = new Error('authenticated workspace restore cancelled')

interface AuthenticatedWorkspaceRestoreRun {
  cancel: () => void
}

type WorkspaceRestoreOutcome =
  | { status: 'completed' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

export function useAuthenticatedAppBootstrap(options?: {
  activeRepoRoot?: string | null
}): AuthenticatedAppBootstrapResult {
  const activeRepoRootRef = useRef(options?.activeRepoRoot ?? null)
  const restoreRunRef = useRef<AuthenticatedWorkspaceRestoreRun | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<AuthenticatedAppBootstrapState>(RESTORING_WORKSPACE_BOOTSTRAP_STATE)

  useEffect(() => {
    if (restoreRunRef.current) return
    setState(RESTORING_WORKSPACE_BOOTSTRAP_STATE)
    const run = startAuthenticatedWorkspaceRestoreRun((outcome) => {
      if (outcome.status === 'completed') {
        setState(READY_BOOTSTRAP_STATE)
      } else if (outcome.status === 'failed') {
        setState({ status: 'failed', message: outcome.message })
      }
    }, activeRepoRootRef.current)
    restoreRunRef.current = run
    return () => {
      run.cancel()
      if (restoreRunRef.current === run) restoreRunRef.current = null
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}

function startAuthenticatedWorkspaceRestoreRun(
  onSettled: (outcome: WorkspaceRestoreOutcome) => void,
  activeRepoRoot: string | null,
): AuthenticatedWorkspaceRestoreRun {
  let cancelled = false
  const timeout = createTimeoutAbortController(
    AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS,
    `authenticated workspace restore timed out after ${AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS}ms`,
  )
  // One settings read fans out to theme and session restore.
  // Promise.resolve() converts synchronous configuration failures into the same
  // async failure channel as fetch errors, so restoreBootSession owns the result.
  const settingsSnapshot = Promise.resolve().then(() => getSettingsSnapshot({ signal: timeout.signal }))
  void primeExternalAppsQueryCache(timeout.signal).catch((err) => {
    if (!timeout.signal.aborted) bootstrapLog.warn('external apps priming failed', { err })
  })
  void hydrateNonCriticalAuthenticatedState(settingsSnapshot, timeout.signal)
  void restoreBootSession(settingsSnapshot, timeout.signal, activeRepoRoot).then((outcome) => {
    timeout.dispose()
    if (!cancelled && outcome.status !== 'cancelled') onSettled(outcome)
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
  activeRepoRoot: string | null,
): Promise<WorkspaceRestoreOutcome> {
  try {
    useReposStore.setState({ sessionPersistenceReady: false, sessionRestoreError: null })
    const presentation = await readClientWorkspaceState()
    const snapshot = await abortable(settingsSnapshot, signal)
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), snapshot)
    if (signal.aborted) throw abortReason(signal)
    const restored = await abortable(
      restoreWorkspaceAtBoot(readOrCreateWebTerminalClientId(), {
        activeRepoRoot: activeRepoRoot ?? presentation.restoredRepoId,
        signal,
      }),
      signal,
    )
    if (restored.status === 'repaired') {
      bootstrapLog.warn('workspace restore dropped invalid or unavailable state')
    }
    const session = composeRestoredWorkspaceSession(
      restored.openRepoEntries,
      presentation,
      restored.runtime.restoredRepoId,
    )
    applyRestoredWorkspaceSession(session)
    await abortable(
      useReposStore.getState().hydrateRestoredWorkspaceRuntime(restored.runtime, {
        signal,
        restoredSession: session,
      }),
      signal,
    )
    if (signal.aborted) throw abortReason(signal)
    useReposStore.setState({
      sessionPersistenceReady: true,
      sessionRestoreError: null,
    })
    return { status: 'completed' }
  } catch (err) {
    if (signal.reason === AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED && isAbortReason(err, signal)) {
      return { status: 'cancelled' }
    }
    bootstrapLog.warn('session restore failed', { err })
    const message = restoreFailureMessage(err)
    blockSessionPersistenceAfterRestoreFailure(message)
    return { status: 'failed', message }
  }
}

function applyRestoredWorkspaceSession(session: ClientWorkspaceState): void {
  // Apply layout prefs before repo probing finishes so the first
  // restored paint uses the saved geometry. Client workspace persistence
  // still waits for workspaceMembershipReady, so this cannot overwrite the
  // persisted session with a partially hydrated one.
  const normalizedLayout = normalizeWorkspaceSessionLayoutState(session)
  const restoredWorkspaceState = restoreRestorableWorkspaceStateFromSession(session)
  const { applySessionLayoutState, applySessionSelectedTerminalState } = useReposStore.getState()
  restoreFiletreeViewStateFromSession(session.filetreeViewStateByWorktreeByRepo)
  applySessionLayoutState(normalizedLayout)
  applySessionSelectedTerminalState(restoredWorkspaceState.selectedTerminalSessionIdByTerminalWorktree)
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

function blockSessionPersistenceAfterRestoreFailure(message: string): void {
  useReposStore.setState({
    workspaceMembershipReady: false,
    sessionPersistenceReady: false,
    sessionRestoreError: message,
  })
}

function composeRestoredWorkspaceSession(
  openRepoEntries: RepoSessionEntry[],
  presentation: ClientWorkspaceState,
  serverRestoredRepoId: string | null,
): ClientWorkspaceState {
  const openRepoIds = new Set(openRepoEntries.map(repoSessionEntryId))
  return {
    ...presentation,
    restoredRepoId:
      presentation.restoredRepoId && openRepoIds.has(presentation.restoredRepoId)
        ? presentation.restoredRepoId
        : serverRestoredRepoId,
  }
}

function restoreFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'session restore failed'
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new Error('authenticated workspace restore aborted')
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
 * Prime external-apps query cache from the authenticated endpoint so settings
 * pages render with persisted values on first paint instead of flashing the
 * defaults. Settings snapshot cache is populated by restoreBootSession, which
 * also owns server-repaired session reconciliation.
 */
async function primeExternalAppsQueryCache(signal: AbortSignal): Promise<void> {
  try {
    primaryWindowQueryClient.setQueryData(externalAppsQueryKey(), await getExternalAppsSnapshot({ signal }))
  } catch (err) {
    if (signal.aborted && isAbortReason(err, signal)) return
    bootstrapLog.warn('external apps query prime failed', { err })
  }
}
