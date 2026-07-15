import PQueue from 'p-queue'
import {
  IpcError,
  isProjectedRestoredWorkspaceRepo,
  type ProjectedRestoredWorkspaceRepoRuntime,
  type RepoWorkspaceTabsRestoreResult,
  type RepoRuntimeProjection,
  type RestoredWorkspaceRepoRuntime,
  type WorkspaceRuntimeRestoreSnapshot,
  type ServerWorkspaceState,
} from '#/shared/api-types.ts'
import {
  repoSessionEntryId,
  type RemoteRepoSessionEntry,
  type RemoteRepoTarget,
  type RepoSessionEntry,
} from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  parseWorkspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { probeRepo, readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  acquireRepoRuntimeLease,
  isCurrentRepoRuntimeMembership,
  releaseRepoRuntimeMembershipLease,
  type RepoRuntimeMembershipLeaseEntry,
} from '#/server/modules/repo-runtimes.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import {
  clearServerWorkspaceTabsIfUnchanged,
  compareAndReplaceServerWorkspaceRepos,
  confirmServerWorkspaceRepoEntry,
  confirmServerWorkspaceTabsUnchanged,
  getServerWorkspaceState,
} from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

export interface RestoreServerWorkspaceInput {
  userId: string
  clientId: string
  // The repo the user is currently viewing. Only this repo gets the full
  // projection read + pane-tab restore at cold start. Other repos are
  // validated/canonicalized, then returned as stub leases and restored lazily
  // when the user navigates to them.
  activeRepoRoot?: string | null
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

export interface RestoredServerWorkspace {
  status: 'restored' | 'repaired'
  openRepoEntries: RepoSessionEntry[]
  runtime: WorkspaceRuntimeRestoreSnapshot
}

type RestoredServerWorkspaceSnapshot = RestoredServerWorkspace

export interface RestoreRepoTabsInput {
  userId: string
  clientId: string
  repoRoot: string
  repoRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

type OpenSessionRepoResult = { kind: 'opened'; opened: OpenedRepoSessionEntry } | { kind: 'invalid' }
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

const MAX_WORKSPACE_REPAIR_CONFLICT_RETRIES = 3
const MAX_WORKSPACE_MEMBERSHIP_CONFLICT_RETRIES = 3
const restoreQueues = new Map<string, PQueue>()

export async function restoreServerWorkspace(input: RestoreServerWorkspaceInput): Promise<RestoredServerWorkspace> {
  input.signal?.throwIfAborted()
  const key = restoreQueueKey(input.userId, input.clientId)
  const queue = restoreQueueFor(key)
  try {
    return await queue.add(async () => {
      input.signal?.throwIfAborted()
      let workspace = await getServerWorkspaceState()
      const restoreInput = {
        ...input,
        activeRepoRoot: input.activeRepoRoot ?? workspace.openRepoEntries[0]?.id ?? null,
      }
      const openedByRoot = new Map<string, OpenedRepoSessionEntry>()
      let repaired = false
      let committed = false
      try {
        for (let conflicts = 0; ; conflicts += 1) {
          const outcome = await restoreServerWorkspaceSnapshot(restoreInput, workspace, openedByRoot)
          if (outcome.kind === 'restored') {
            committed = true
            return {
              ...outcome.value,
              status: repaired || outcome.value.status === 'repaired' ? 'repaired' : 'restored',
            }
          }
          repaired ||= outcome.repaired
          if (conflicts >= MAX_WORKSPACE_MEMBERSHIP_CONFLICT_RETRIES) {
            throw new Error('workspace membership restore was superseded too many times')
          }
          workspace = outcome.latestWorkspace
        }
      } finally {
        if (!committed) releaseOpenedRepoRuntimes(input, openedByRoot.values())
      }
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

type RestoreServerWorkspaceSnapshotOutcome =
  | { kind: 'restored'; value: RestoredServerWorkspaceSnapshot }
  | { kind: 'membership-conflict'; latestWorkspace: ServerWorkspaceState; repaired: boolean }

async function restoreServerWorkspaceSnapshot(
  input: RestoreServerWorkspaceInput,
  source: ServerWorkspaceState,
  openedByRoot: Map<string, OpenedRepoSessionEntry>,
): Promise<RestoreServerWorkspaceSnapshotOutcome> {
  input.signal?.throwIfAborted()
  let repoRestoreFailed = false
  const activeRepoRoot = input.activeRepoRoot ?? null
  reconcileOpenedRepoMemberships(input, source.openRepoEntries, openedByRoot)
  for (const entry of source.openRepoEntries) {
    if (openedByRoot.has(repoSessionEntryId(entry))) continue
    const result = await openSessionRepo(input, entry, {
      active: repoSessionEntryId(entry) === activeRepoRoot,
    })
    if (result.kind === 'invalid') {
      repoRestoreFailed = true
      continue
    }
    openedByRoot.set(result.opened.repoRoot, result.opened)
  }

  input.signal?.throwIfAborted()
  const opened = source.openRepoEntries.flatMap((entry) => {
    const repo = openedByRoot.get(repoSessionEntryId(entry))
    return repo ? [repo] : []
  })
  const membership = await compareAndReplaceServerWorkspaceRepos(
    source.openRepoEntries,
    opened.map((repo) => repo.entry),
  )
  if (!membership.matched) {
    return { kind: 'membership-conflict', latestWorkspace: membership.latestWorkspace, repaired: false }
  }

  // Only the active repo's tabs are validated and restored at startup.
  // Non-active repos carry `projection: null` and are restored lazily.
  const openedActive = opened.filter(isOpenedProjectedRepo)
  const validatedWorkspace = openedActive[0]
    ? await validateOrRepairWorkspacePaneTabs(membership.workspace, openedActive[0], openedActive[0].entry)
    : { kind: 'validated' as const, workspace: membership.workspace, repaired: false }
  if (validatedWorkspace.kind === 'membership-conflict') {
    return {
      kind: 'membership-conflict',
      latestWorkspace: validatedWorkspace.latestWorkspace,
      repaired: repoRestoreFailed,
    }
  }

  const confirmed = await compareAndReplaceServerWorkspaceRepos(
    membership.workspace.openRepoEntries,
    membership.workspace.openRepoEntries,
  )
  if (!confirmed.matched) {
    return {
      kind: 'membership-conflict',
      latestWorkspace: confirmed.latestWorkspace,
      repaired: repoRestoreFailed || validatedWorkspace.repaired,
    }
  }

  const stableWorkspace = {
    ...validatedWorkspace.workspace,
    openRepoEntries: confirmed.workspace.openRepoEntries,
  }
  input.signal?.throwIfAborted()
  const workspacePaneTabs = await restoreWorkspacePaneTabsForRepos(input, stableWorkspace, openedActive)
  input.signal?.throwIfAborted()
  const committedMembership = await compareAndReplaceServerWorkspaceRepos(
    stableWorkspace.openRepoEntries,
    stableWorkspace.openRepoEntries,
  )
  if (!committedMembership.matched) {
    return {
      kind: 'membership-conflict',
      latestWorkspace: committedMembership.latestWorkspace,
      repaired: repoRestoreFailed || validatedWorkspace.repaired,
    }
  }
  return {
    kind: 'restored',
    value: {
      status: repoRestoreFailed || validatedWorkspace.repaired ? 'repaired' : 'restored',
      openRepoEntries: opened.map((repo) => repo.entry),
      runtime: runtimeSnapshotFromOpened(
        opened,
        activeRepoRootForOpened(input.activeRepoRoot, opened),
        workspacePaneTabs,
      ),
    },
  }
}

function reconcileOpenedRepoMemberships(
  input: RestoreServerWorkspaceInput,
  entries: readonly RepoSessionEntry[],
  openedByRoot: Map<string, OpenedRepoSessionEntry>,
): void {
  const expectedByRoot = new Map(entries.map((entry) => [repoSessionEntryId(entry), entry]))
  for (const [repoRoot, opened] of openedByRoot) {
    const expected = expectedByRoot.get(repoRoot)
    if (expected && sameRepoSessionEntry(opened.entry, expected)) continue
    releaseSessionRepoRuntime(input, opened.lease)
    openedByRoot.delete(repoRoot)
  }
}

function sameRepoSessionEntry(a: RepoSessionEntry, b: RepoSessionEntry): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === 'local' || b.kind === 'local') return true
  return (
    a.ref.id === b.ref.id &&
    a.ref.alias === b.ref.alias &&
    a.ref.remotePath === b.ref.remotePath &&
    a.ref.displayName === b.ref.displayName
  )
}

async function openSessionRepo(
  input: RestoreServerWorkspaceInput,
  entry: RepoSessionEntry,
  options: { active: boolean },
): Promise<OpenSessionRepoResult> {
  input.signal?.throwIfAborted()
  if (entry.kind === 'remote') return await openRemoteSessionRepo(input, entry, options)
  const probe = await probeRepo(entry.id)
  if (!probe.ok || !probe.root) {
    const lease = acquireRepoRuntimeLease(input.userId, entry.id, input.clientId)
    return { kind: 'opened', opened: localRepoStub(entry.id, null, lease) }
  }
  if (probe.root !== entry.id) return { kind: 'invalid' }
  const lease = acquireRepoRuntimeLease(input.userId, probe.root, input.clientId)
  if (!options.active) {
    // Stub path: validated lease only. No projection read or pane-tab restore.
    // Persisted local entries must already be canonical; this branch refuses to
    // migrate non-canonical paths and lets the session rebuild path clean them.
    return {
      kind: 'opened',
      opened: localRepoStub(probe.root, probe.name, lease),
    }
  }
  try {
    const projection = await readRepoProjection(probe.root, {
      repoRuntimeId: lease.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      return { kind: 'opened', opened: localRepoStub(probe.root, probe.name, lease) }
    }
    return {
      kind: 'opened',
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
  input: RestoreServerWorkspaceInput,
  entry: RemoteRepoSessionEntry,
  options: { active: boolean },
): Promise<OpenSessionRepoResult> {
  const lease = acquireRepoRuntimeLease(input.userId, entry.id, input.clientId)
  if (!options.active) {
    // Stub path for remote repos: still need a name but no lifecycle / projection.
    return {
      kind: 'opened',
      opened: remoteRepoStub(entry, entry.ref.displayName, lease),
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
      if (lifecycle.kind === 'settled') {
        return {
          kind: 'opened',
          opened: remoteRepoStub(entry, lifecycle.name, lease),
        }
      }
      releaseSessionRepoRuntime(input, lease)
      throw new Error('workspace repo runtime was superseded during restore')
    }
    const projection = await readRepoProjection(entry.id, {
      repoRuntimeId: lease.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      return {
        kind: 'opened',
        opened: remoteRepoStub(entry, lifecycle.name, lease, lifecycle.lifecycle.target),
      }
    }
    return {
      kind: 'opened',
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

function localRepoStub(
  repoRoot: string,
  name: string | null | undefined,
  lease: RepoRuntimeMembershipLeaseEntry,
): OpenedRepoSessionEntry {
  return {
    entry: { kind: 'local', id: repoRoot },
    repoRoot,
    repoRuntimeId: lease.repoRuntimeId,
    name: name ?? lastPathSegment(repoRoot),
    projection: null,
    lease,
  }
}

function remoteRepoStub(
  entry: RemoteRepoSessionEntry,
  name: string,
  lease: RepoRuntimeMembershipLeaseEntry,
  target?: RemoteRepoTarget,
): OpenedRepoSessionEntry {
  return {
    entry,
    repoRoot: entry.id,
    repoRuntimeId: lease.repoRuntimeId,
    name,
    ...(target ? { target } : {}),
    projection: null,
    lease,
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
  workspace: ServerWorkspaceState,
  opened: ProjectedRestoredWorkspaceRepoRuntime[],
): WorkspaceSessionValidationResult {
  const openedByRoot = openedRepoByRoot(opened)
  for (const [repoRoot, tabsByTarget] of Object.entries(workspace.workspacePaneTabsByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    // Stub leases (non-active repos at cold start) carry `projection: null`
    // and their tabs will be restored lazily. Defer validation to the lazy
    // path; do not force a session rebuild.
    if (!repo) continue
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
export async function restoreRepoTabsForRepo(input: RestoreRepoTabsInput): Promise<RepoWorkspaceTabsRestoreResult> {
  input.signal?.throwIfAborted()
  assertCurrentRepoRuntimeMembership(input)
  const initialWorkspace = await getServerWorkspaceState()
  assertCurrentRepoRuntimeMembership(input)
  const entry = workspaceRepoEntry(initialWorkspace, input.repoRoot)
  if (!entry) throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  const repo = await projectSessionRepo(input, entry)
  if (!repo) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
  }

  const membership = await confirmServerWorkspaceRepoEntry(entry)
  if (!membership.matched) throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  const validatedWorkspace = await validateOrRepairWorkspacePaneTabs(membership.workspace, repo, entry)
  if (validatedWorkspace.kind === 'membership-conflict') {
    throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  }
  const confirmed = await confirmServerWorkspaceRepoEntry(entry)
  if (!confirmed.matched) throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })

  const snapshots = await restoreWorkspacePaneTabsForRepos(
    {
      userId: input.userId,
      clientId: input.clientId,
      workspacePaneTabsHost: input.workspacePaneTabsHost,
      signal: input.signal,
    },
    validatedWorkspace.workspace,
    [repo],
  )
  assertCurrentRepoRuntimeMembership(input)
  const committedMembership = await confirmServerWorkspaceRepoEntry(entry)
  if (!committedMembership.matched) {
    throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  }
  return {
    repo,
    snapshot: snapshots[0]?.snapshot ?? null,
  }
}

async function validateOrRepairWorkspacePaneTabs(
  initialWorkspace: ServerWorkspaceState,
  repo: ProjectedRestoredWorkspaceRepoRuntime,
  expectedRepoEntry: RepoSessionEntry,
): Promise<
  | { kind: 'validated'; workspace: ServerWorkspaceState; repaired: boolean }
  | { kind: 'membership-conflict'; latestWorkspace: ServerWorkspaceState }
> {
  let workspace = initialWorkspace
  for (let conflicts = 0; ; conflicts += 1) {
    const currentEntry = workspaceRepoEntry(workspace, repo.repoRoot)
    if (!currentEntry || !sameRepoSessionEntry(currentEntry, expectedRepoEntry)) {
      return { kind: 'membership-conflict', latestWorkspace: workspace }
    }
    const repoWorkspace = workspaceForRepoTabs(workspace, repo.repoRoot)
    const expectedTabsByTarget = repoWorkspace.workspacePaneTabsByTargetByRepo[repo.repoRoot] ?? {}
    if (validateWorkspacePaneTabs(repoWorkspace, [repo]).ok) {
      const confirmed = await confirmServerWorkspaceTabsUnchanged({
        repoRoot: repo.repoRoot,
        expectedRepoEntry,
        expectedTabsByTarget,
      })
      if (confirmed.matched) return { kind: 'validated', workspace: confirmed.workspace, repaired: false }
      if (conflicts >= MAX_WORKSPACE_REPAIR_CONFLICT_RETRIES) {
        throw new Error('workspace tabs validation was superseded too many times')
      }
      workspace = confirmed.latestWorkspace
      continue
    }
    const cleared = await clearServerWorkspaceTabsIfUnchanged({
      repoRoot: repo.repoRoot,
      expectedRepoEntry,
      expectedTabsByTarget,
    })
    if (cleared.cleared) return { kind: 'validated', workspace: cleared.workspace, repaired: true }
    if (conflicts >= MAX_WORKSPACE_REPAIR_CONFLICT_RETRIES) {
      throw new Error('workspace tabs repair was superseded too many times')
    }
    workspace = cleared.latestWorkspace
  }
}

function workspaceRepoEntry(workspace: ServerWorkspaceState, repoRoot: string): RepoSessionEntry | null {
  return workspace.openRepoEntries.find((entry) => repoSessionEntryId(entry) === repoRoot) ?? null
}

function workspaceForRepoTabs(workspace: ServerWorkspaceState, repoRoot: string): ServerWorkspaceState {
  return {
    openRepoEntries: workspace.openRepoEntries,
    workspacePaneTabsByTargetByRepo: {
      [repoRoot]: workspace.workspacePaneTabsByTargetByRepo[repoRoot] ?? {},
    },
  }
}

async function projectSessionRepo(
  input: RestoreRepoTabsInput,
  entry: RepoSessionEntry,
): Promise<ProjectedRestoredWorkspaceRepoRuntime | null> {
  if (entry.kind === 'remote') {
    const lifecycle = await abortable(
      runRemoteLifecycleWrite({
        userId: input.userId,
        repoId: entry.id,
        repoRuntimeId: input.repoRuntimeId,
        mode: 'ensure',
      }),
      input.signal,
    )
    assertCurrentRepoRuntimeMembership(input)
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') return null
    const projection = await readRepoProjection(entry.id, {
      repoRuntimeId: input.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    assertCurrentRepoRuntimeMembership(input)
    if (!projection.snapshot) return null
    return {
      entry,
      repoRoot: entry.id,
      repoRuntimeId: input.repoRuntimeId,
      name: lifecycle.name,
      target: lifecycle.lifecycle.target,
      projection,
    }
  }

  const probe = await probeRepo(entry.id)
  assertCurrentRepoRuntimeMembership(input)
  if (!probe.ok || !probe.root || probe.root !== entry.id) return null
  const projection = await readRepoProjection(probe.root, {
    repoRuntimeId: input.repoRuntimeId,
    signal: input.signal,
    mode: 'full',
  })
  assertCurrentRepoRuntimeMembership(input)
  if (!projection.snapshot) return null
  return {
    entry: { kind: 'local', id: probe.root },
    repoRoot: probe.root,
    repoRuntimeId: input.repoRuntimeId,
    name: probe.name ?? lastPathSegment(probe.root),
    projection,
  }
}

function assertCurrentRepoRuntimeMembership(input: RestoreRepoTabsInput): void {
  if (isCurrentRepoRuntimeMembership(input.userId, input.repoRoot, input.repoRuntimeId, input.clientId)) {
    return
  }
  throw new IpcError({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
}

function isOpenedProjectedRepo(repo: OpenedRepoSessionEntry): repo is OpenedProjectedRepoSessionEntry {
  return isProjectedRestoredWorkspaceRepo(repo)
}

async function restoreWorkspacePaneTabsForRepos(
  input: RestoreServerWorkspaceInput,
  workspace: ServerWorkspaceState,
  opened: ProjectedRestoredWorkspaceRepoRuntime[],
): Promise<Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>> {
  if (opened.length === 0) return []
  const replacements = workspacePaneTabRestoreReplacements(workspace, opened)
  input.signal?.throwIfAborted()
  const snapshots = []
  for (const repo of opened) {
    input.signal?.throwIfAborted()
    const snapshot = await input.workspacePaneTabsHost.initializeTabs(input.userId, {
      repoRoot: repo.repoRoot,
      repoRuntimeId: repo.repoRuntimeId,
      entries: replacements
        .filter((replacement) => replacement.repoRoot === repo.repoRoot)
        .map((replacement) => ({
          repoRoot: replacement.repoRoot,
          branchName: replacement.target.branchName,
          worktreePath: replacement.target.worktreePath,
          tabs: replacement.tabs,
        })),
    })
    snapshots.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, snapshot })
  }
  return snapshots
}

function workspacePaneTabRestoreReplacements(
  workspace: ServerWorkspaceState,
  opened: ProjectedRestoredWorkspaceRepoRuntime[],
): WorkspacePaneTabsRestoreReplacement[] {
  const openedByRoot = openedRepoByRoot(opened)
  const replacements: WorkspacePaneTabsRestoreReplacement[] = []
  for (const [repoRoot, tabsByTarget] of Object.entries(workspace.workspacePaneTabsByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    if (!repo) continue
    for (const [targetKey, tabs] of Object.entries(tabsByTarget)) {
      const target = targetForSessionKey(repo, targetKey)
      if (!target) continue
      replacements.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, target, tabs })
    }
  }
  return replacements
}

function targetForSessionKey(
  repo: ProjectedRestoredWorkspaceRepoRuntime,
  targetKey: string,
): WorkspacePaneTabsTarget | null {
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
  return branch ? { repoRoot: repo.repoRoot, branchName: branch.name, worktreePath: target.worktreePath } : null
}

function activeRepoRootForOpened(
  activeRepoRoot: string | null | undefined,
  opened: OpenedRepoSessionEntry[],
): string | null {
  if (activeRepoRoot && opened.some((repo) => repo.repoRoot === activeRepoRoot)) return activeRepoRoot
  return opened[0]?.repoRoot ?? null
}

function openedRepoByRoot<T extends RestoredWorkspaceRepoRuntime>(opened: T[]): Map<string, T> {
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

function releaseOpenedRepoRuntimes(input: RestoreServerWorkspaceInput, opened: Iterable<OpenedRepoSessionEntry>): void {
  for (const repo of opened) releaseSessionRepoRuntime(input, repo.lease)
}

function releaseSessionRepoRuntime(input: RestoreServerWorkspaceInput, lease: RepoRuntimeMembershipLeaseEntry): void {
  releaseRepoRuntimeMembershipLease(input.userId, input.clientId, lease)
}

function lastPathSegment(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '')
  const segment = trimmed.split(/[\\/]/).pop()
  return segment || value
}

export type { WorkspacePaneTabsSnapshot }
