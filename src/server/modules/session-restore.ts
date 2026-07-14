import PQueue from 'p-queue'
import { defaultWorkspaceSessionState } from '#/shared/settings-defaults.ts'
import {
  IpcError,
  isProjectedRestoredWorkspaceRepo,
  type ProjectedRestoredWorkspaceRepoRuntime,
  type RepoRuntimeProjection,
  type RestoredWorkspaceRepoRuntime,
  type WorkspaceRuntimeRestoreSnapshot,
  type WorkspaceSessionState,
} from '#/shared/api-types.ts'
import { repoSessionEntryId, type RemoteRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  isWorkspacePaneStaticTabType,
  type WorkspacePaneSessionTabType,
  type WorkspacePaneTabEntry,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  parseWorkspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { probeRepo, readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  acquireRepoRuntimeLease,
  isCurrentRepoRuntime,
  releaseRepoRuntimeMembershipLease,
  type RepoRuntimeMembershipLeaseEntry,
} from '#/server/modules/repo-runtimes.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { getServerSessionState, saveRebuiltServerSessionState } from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

export interface RestoreServerWorkspaceSessionInput {
  userId: string
  clientId: string
  // The repo the user is currently viewing. Only this repo gets the full
  // git probe + projection read + pane-tab restore at cold start. Other
  // repos get stub leases (no git I/O) and are restored lazily when the
  // user navigates to them.
  activeRepoRoot?: string | null
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

export interface RestoredServerWorkspaceSession {
  status: 'restored' | 'rebuilt'
  session: WorkspaceSessionState
  runtime: WorkspaceRuntimeRestoreSnapshot
}

export interface RestoreRepoTabsInput {
  userId: string
  clientId: string
  repoRoot: string
  repoRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

type OpenSessionRepoResult = { ok: true; opened: OpenedRepoSessionEntry } | { ok: false }
type WorkspaceSessionValidationResult = { ok: true } | { ok: false }

type OpenedRepoSessionEntry = RestoredWorkspaceRepoRuntime & {
  lease: RepoRuntimeMembershipLeaseEntry
}
type OpenedProjectedRepoSessionEntry = ProjectedRestoredWorkspaceRepoRuntime & {
  lease: RepoRuntimeMembershipLeaseEntry
}

interface WorkspacePaneTabsRestoreReplacement {
  repoRoot: string
  repoRuntimeId: string
  target: WorkspacePaneTabsTarget
  tabs: WorkspacePaneTabEntry[]
}

const MAX_REBUILD_CONFLICT_RETRIES = 3
const restoreQueues = new Map<string, PQueue>()

export async function restoreServerWorkspaceSession(
  input: RestoreServerWorkspaceSessionInput,
): Promise<RestoredServerWorkspaceSession> {
  input.signal?.throwIfAborted()
  const key = restoreQueueKey(input.userId, input.clientId)
  const queue = restoreQueueFor(key)
  try {
    return await queue.add(async () => {
      input.signal?.throwIfAborted()
      const session = await getServerSessionState()
      return await restoreServerWorkspaceSessionSnapshot(
        { ...input, activeRepoRoot: input.activeRepoRoot ?? session.restoredRepoId ?? null },
        session,
        0,
      )
    })
  } finally {
    void queue.onIdle().then(() => {
      if (restoreQueues.get(key) === queue && queue.size === 0 && queue.pending === 0) restoreQueues.delete(key)
    })
  }
}

function restoreQueueKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`
}

function restoreQueueFor(key: string): PQueue {
  let queue = restoreQueues.get(key)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    restoreQueues.set(key, queue)
  }
  return queue
}

async function restoreServerWorkspaceSessionSnapshot(
  input: RestoreServerWorkspaceSessionInput,
  session: WorkspaceSessionState,
  conflictRetries: number,
): Promise<RestoredServerWorkspaceSession> {
  input.signal?.throwIfAborted()
  const opened: OpenedRepoSessionEntry[] = []
  let openedMembershipsCommitted = false
  const activeRepoRoot = input.activeRepoRoot ?? null
  try {
    for (const entry of session.openRepoEntries) {
      const result = await openSessionRepo(input, entry, {
        active: repoSessionEntryId(entry) === activeRepoRoot,
      })
      if (!result.ok) {
        return await saveRebuiltOrRestoreLatest(input, session, defaultWorkspaceSessionState(), conflictRetries)
      }
      opened.push(result.opened)
    }

    input.signal?.throwIfAborted()
    // Only the active repo's tabs are validated and restored at startup.
    // Non-active repos carry `projection: null` so their `targetForSessionKey`
    // cannot resolve — and their tabs will be restored lazily when the user
    // navigates to them via `restoreWorkspacePaneTabsForRepo`.
    const openedActive = opened.filter(isOpenedProjectedRepo)
    if (
      !validateWorkspacePaneTabs(session, openedActive).ok ||
      !validatePreferredWorkspacePaneTabs(session, openedActive).ok
    ) {
      const saved = await saveRebuiltServerSessionState({
        persistedSnapshot: session,
        rebuiltSession: cleanSessionFromOpened(session, opened),
      })
      if (saved.saved) {
        openedMembershipsCommitted = true
        return { status: 'rebuilt', session: saved.session, runtime: runtimeSnapshotFromOpened(opened, saved.session.restoredRepoId, []) }
      }
      if (conflictRetries >= MAX_REBUILD_CONFLICT_RETRIES) {
        throw new Error('workspace session restore was superseded too many times')
      }
      return await restoreServerWorkspaceSessionSnapshot(input, saved.latestSession, conflictRetries + 1)
    }

    input.signal?.throwIfAborted()
    const workspacePaneTabs = await restoreWorkspacePaneTabsForRepos(input, session, openedActive)
    input.signal?.throwIfAborted()
    openedMembershipsCommitted = true
    const restoredSession = canonicalSessionFromOpened(session, opened)
    return {
      status: 'restored',
      session: restoredSession,
      runtime: runtimeSnapshotFromOpened(opened, restoredSession.restoredRepoId, workspacePaneTabs),
    }
  } finally {
    if (!openedMembershipsCommitted) releaseOpenedRepoRuntimes(input, opened)
  }
}

async function saveRebuiltOrRestoreLatest(
  input: RestoreServerWorkspaceSessionInput,
  session: WorkspaceSessionState,
  rebuiltSession: WorkspaceSessionState,
  conflictRetries: number,
): Promise<RestoredServerWorkspaceSession> {
  const saved = await saveRebuiltServerSessionState({ persistedSnapshot: session, rebuiltSession })
  if (saved.saved) return { status: 'rebuilt', session: saved.session, runtime: runtimeSnapshotFromOpened([], null, []) }
  if (conflictRetries >= MAX_REBUILD_CONFLICT_RETRIES) {
    throw new Error('workspace session restore was superseded too many times')
  }
  return await restoreServerWorkspaceSessionSnapshot(input, saved.latestSession, conflictRetries + 1)
}

async function openSessionRepo(
  input: RestoreServerWorkspaceSessionInput,
  entry: RepoSessionEntry,
  options: { active: boolean },
): Promise<OpenSessionRepoResult> {
  input.signal?.throwIfAborted()
  if (entry.kind === 'remote') return await openRemoteSessionRepo(input, entry, options)
  if (!options.active) {
    // Stub path: lease only. No `probeRepo`, no `readRepoProjection`, no
    // git I/O. The lease is keyed on `entry.id` (= repoRoot) and is reused
    // later when the user navigates to this repo.
    const lease = acquireRepoRuntimeLease(input.userId, entry.id, input.clientId)
    return {
      ok: true,
      opened: {
        entry: { kind: 'local', id: entry.id },
        repoRoot: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        name: lastPathSegment(entry.id),
        projection: null,
        lease,
      },
    }
  }
  const probe = await probeRepo(entry.id)
  if (!probe.ok || !probe.root) return { ok: false }
  const lease = acquireRepoRuntimeLease(input.userId, probe.root, input.clientId)
  try {
    const projection = await readRepoProjection(probe.root, { repoRuntimeId: lease.repoRuntimeId, signal: input.signal, mode: 'full' })
    if (!projection.snapshot) {
      releaseSessionRepoRuntime(input, lease)
      return { ok: false }
    }
    return {
      ok: true,
      opened: {
        entry: { kind: 'local', id: probe.root },
        repoRoot: probe.root,
        repoRuntimeId: lease.repoRuntimeId,
        name: probe.name ?? lastPathSegment(probe.root),
        projection,
        lease,
      },
    }
  } catch (err) {
    releaseSessionRepoRuntime(input, lease)
    throw err
  }
}

async function openRemoteSessionRepo(
  input: RestoreServerWorkspaceSessionInput,
  entry: RemoteRepoSessionEntry,
  options: { active: boolean },
): Promise<OpenSessionRepoResult> {
  const lease = acquireRepoRuntimeLease(input.userId, entry.id, input.clientId)
  if (!options.active) {
    // Stub path for remote repos: still need a name but no lifecycle / projection.
    return {
      ok: true,
      opened: {
        entry,
        repoRoot: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        name: entry.ref.displayName,
        projection: null,
        lease,
      },
    }
  }
  try {
    const lifecycle = await abortable(
      runRemoteLifecycleWrite({
        userId: input.userId,
        repoId: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        mode: 'ensure',
      }),
      input.signal,
    )
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') {
      releaseSessionRepoRuntime(input, lease)
      return { ok: false }
    }
    const projection = await readRepoProjection(entry.id, { repoRuntimeId: lease.repoRuntimeId, signal: input.signal, mode: 'full' })
    if (!projection.snapshot) {
      releaseSessionRepoRuntime(input, lease)
      return { ok: false }
    }
    return {
      ok: true,
      opened: {
        entry,
        repoRoot: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        name: lifecycle.name,
        target: lifecycle.lifecycle.target,
        projection,
        lease,
      },
    }
  } catch (err) {
    releaseSessionRepoRuntime(input, lease)
    throw err
  }
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise
  signal.throwIfAborted()
  let onAbort: (() => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('workspace session restore aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function validateWorkspacePaneTabs(
  session: WorkspaceSessionState,
  opened: OpenedRepoSessionEntry[],
): WorkspaceSessionValidationResult {
  const openedByRoot = openedRepoByRoot(opened)
  for (const [repoRoot, tabsByTarget] of Object.entries(session.workspacePaneTabsByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    // Stub leases (non-active repos at cold start) carry `projection: null`
    // and their tabs will be restored lazily. Defer validation to the lazy
    // path; do not force a session rebuild.
    if (!repo || !isOpenedProjectedRepo(repo)) continue
    for (const targetKey of Object.keys(tabsByTarget)) {
      if (!targetForSessionKey(repo, targetKey)) return { ok: false }
    }
  }
  return { ok: true }
}

/**
 * Restore pane tabs for a single repo on demand (lazy restore from
 * `useRestoreRepoTabsOnView` when the user navigates to a stub repo).
 *
 * Returns the same snapshot shape as the per-repo entry in
 * `WorkspaceRuntimeRestoreSnapshot.workspacePaneTabs`, plus the
 * restored repo (with projection) so the caller can hydrate the store.
 */
export async function restoreRepoTabsForRepo(
  input: RestoreRepoTabsInput,
): Promise<{
  repo: RestoredWorkspaceRepoRuntime
  snapshot: WorkspacePaneTabsSnapshot | null
}> {
  input.signal?.throwIfAborted()
  if (!isCurrentRepoRuntime(input.userId, input.repoRoot, input.repoRuntimeId)) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
  }
  const session = await getServerSessionState()
  const entry = session.openRepoEntries.find((candidate) => repoSessionEntryId(candidate) === input.repoRoot)
  if (!entry) throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })

  const opened = await openSessionRepo(
    { userId: input.userId, clientId: input.clientId, workspacePaneTabsHost: input.workspacePaneTabsHost, signal: input.signal },
    entry,
    { active: true },
  )
  if (!opened.ok || !isOpenedProjectedRepo(opened.opened)) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
  }

  const snapshots = await restoreWorkspacePaneTabsForRepos(
    { userId: input.userId, clientId: input.clientId, workspacePaneTabsHost: input.workspacePaneTabsHost, signal: input.signal },
    session,
    [opened.opened],
  )
  return {
    repo: projectionRepoFromOpened(opened.opened),
    snapshot: snapshots[0]?.snapshot ?? null,
  }
}

function projectionRepoFromOpened(opened: OpenedRepoSessionEntry): RestoredWorkspaceRepoRuntime {
  const { lease: _lease, ...repo } = opened
  return repo
}

function isOpenedProjectedRepo(repo: OpenedRepoSessionEntry): repo is OpenedProjectedRepoSessionEntry {
  return isProjectedRestoredWorkspaceRepo(repo)
}

async function restoreWorkspacePaneTabsForRepos(
  input: RestoreServerWorkspaceSessionInput,
  session: WorkspaceSessionState,
  opened: OpenedRepoSessionEntry[],
): Promise<Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>> {
  const replacements = workspacePaneTabRestoreReplacements(session, opened)
  if (replacements.length === 0) return []
  input.signal?.throwIfAborted()
  if (input.workspacePaneTabsHost.replaceTabsBatch) {
    return await input.workspacePaneTabsHost.replaceTabsBatch(input.clientId, input.userId, {
      replacements: replacements.map((replacement) => ({
        repoRoot: replacement.repoRoot,
        repoRuntimeId: replacement.repoRuntimeId,
        branchName: replacement.target.branchName,
        worktreePath: replacement.target.worktreePath,
        tabs: replacement.tabs,
      })),
    })
  }
  const snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }> = []
  for (const replacement of replacements) {
    input.signal?.throwIfAborted()
    const snapshot = await input.workspacePaneTabsHost.replaceTabs(input.clientId, input.userId, {
      repoRoot: replacement.repoRoot,
      repoRuntimeId: replacement.repoRuntimeId,
      branchName: replacement.target.branchName,
      worktreePath: replacement.target.worktreePath,
      tabs: replacement.tabs,
    })
    upsertWorkspacePaneTabsSnapshot(snapshots, replacement.repoRoot, replacement.repoRuntimeId, snapshot)
  }
  return snapshots
}

function workspacePaneTabRestoreReplacements(
  session: WorkspaceSessionState,
  opened: OpenedRepoSessionEntry[],
): WorkspacePaneTabsRestoreReplacement[] {
  const openedByRoot = openedRepoByRoot(opened)
  const replacements: WorkspacePaneTabsRestoreReplacement[] = []
  for (const [repoRoot, tabsByTarget] of Object.entries(session.workspacePaneTabsByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    if (!repo || !isOpenedProjectedRepo(repo)) continue
    for (const [targetKey, tabs] of Object.entries(tabsByTarget)) {
      const target = targetForSessionKey(repo, targetKey)
      if (!target) continue
      replacements.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, target, tabs })
    }
  }
  return replacements
}

function upsertWorkspacePaneTabsSnapshot(
  snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>,
  repoRoot: string,
  repoRuntimeId: string,
  snapshot: WorkspacePaneTabsSnapshot,
): void {
  const index = snapshots.findIndex((entry) => entry.repoRoot === repoRoot && entry.repoRuntimeId === repoRuntimeId)
  const entry = { repoRoot, repoRuntimeId, snapshot }
  if (index === -1) snapshots.push(entry)
  else snapshots[index] = entry
}

function validatePreferredWorkspacePaneTabs(
  session: WorkspaceSessionState,
  opened: OpenedRepoSessionEntry[],
): WorkspaceSessionValidationResult {
  const openedByRoot = openedRepoByRoot(opened)
  for (const [repoRoot, preferredByTarget] of Object.entries(session.preferredWorkspacePaneTabByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    // See `validateWorkspacePaneTabs` — defer stub repos to the lazy path.
    if (!repo || !isOpenedProjectedRepo(repo)) continue
    for (const [targetKey, preferredTab] of Object.entries(preferredByTarget)) {
      const target = targetForSessionKey(repo, targetKey)
      if (!target) return { ok: false }
      if (!preferredTabValidForTarget(preferredTab, target, session.workspacePaneTabsByTargetByRepo[repoRoot]?.[targetKey] ?? [])) {
        return { ok: false }
      }
    }
  }
  return { ok: true }
}

function preferredTabValidForTarget(
  preferredTab: WorkspacePaneSessionTabType | null,
  target: WorkspacePaneTabsTarget,
  tabs: WorkspacePaneTabEntry[],
): boolean {
  if (preferredTab === null) return true
  if (target.worktreePath === null && workspacePaneTabRequiresWorktree(preferredTab)) return false
  return !(
    isWorkspacePaneStaticTabType(preferredTab) &&
    preferredTab !== 'status' &&
    !tabs.some((tab) => tab.type === preferredTab)
  )
}

function targetForSessionKey(repo: OpenedProjectedRepoSessionEntry, targetKey: string): WorkspacePaneTabsTarget | null {
  if (!repo.projection.snapshot) return null
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.repoRoot !== repo.repoRoot) return null
  const branches = repo.projection.snapshot.branches
  if (target.kind === 'branch') {
    return branches.some((branch) => branch.name === target.branchName)
      ? { repoRoot: repo.repoRoot, branchName: target.branchName, worktreePath: null }
      : null
  }
  const branch = branches.find((candidate) => candidate.worktree?.path === target.worktreePath)
  return branch
    ? { repoRoot: repo.repoRoot, branchName: branch.name, worktreePath: target.worktreePath }
    : null
}

function canonicalSessionFromOpened(
  session: WorkspaceSessionState,
  opened: OpenedRepoSessionEntry[],
): WorkspaceSessionState {
  const openRepoEntries = opened.map((repo) => repo.entry)
  const restoredRepoId = canonicalRestoredRepoId(session, openRepoEntries)
  return { ...session, openRepoEntries, restoredRepoId }
}

function cleanSessionFromOpened(
  session: WorkspaceSessionState,
  opened: OpenedRepoSessionEntry[],
): WorkspaceSessionState {
  const openRepoEntries = opened.map((repo) => repo.entry)
  return {
    ...defaultWorkspaceSessionState(),
    openRepoEntries,
    restoredRepoId: canonicalRestoredRepoId(session, openRepoEntries),
    zenMode: session.zenMode,
    workspacePaneSize: session.workspacePaneSize,
  }
}

function canonicalRestoredRepoId(session: WorkspaceSessionState, openRepoEntries: RepoSessionEntry[]): string | null {
  if (session.restoredRepoId) {
    for (let index = 0; index < session.openRepoEntries.length; index += 1) {
      const persistedEntry = session.openRepoEntries[index]
      const canonicalEntry = openRepoEntries[index]
      if (persistedEntry && canonicalEntry && repoSessionEntryId(persistedEntry) === session.restoredRepoId) {
        return repoSessionEntryId(canonicalEntry)
      }
    }
    const openRepoIds = new Set(openRepoEntries.map(repoSessionEntryId))
    if (openRepoIds.has(session.restoredRepoId)) return session.restoredRepoId
  }
  return openRepoEntries[0]?.id ?? null
}

function openedRepoByRoot(opened: OpenedRepoSessionEntry[]): Map<string, OpenedRepoSessionEntry> {
  return new Map(opened.map((repo) => [repo.repoRoot, repo]))
}

function runtimeSnapshotFromOpened(
  opened: OpenedRepoSessionEntry[],
  restoredRepoId: string | null,
  workspacePaneTabs: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>,
): WorkspaceRuntimeRestoreSnapshot {
  return {
    repos: opened.map(({ lease: _lease, ...repo }) => repo),
    workspacePaneTabs,
    restoredRepoId,
  }
}

function releaseOpenedRepoRuntimes(input: RestoreServerWorkspaceSessionInput, opened: OpenedRepoSessionEntry[]): void {
  for (const repo of opened) releaseSessionRepoRuntime(input, repo.lease)
}

function releaseSessionRepoRuntime(input: RestoreServerWorkspaceSessionInput, lease: RepoRuntimeMembershipLeaseEntry): void {
  releaseRepoRuntimeMembershipLease(input.userId, input.clientId, lease)
}

function lastPathSegment(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '')
  const segment = trimmed.split(/[\\/]/).pop()
  return segment || value
}

export type { WorkspacePaneTabsSnapshot }
