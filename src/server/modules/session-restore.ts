import PQueue from 'p-queue'
import {
  IpcError,
  isProjectedRestoredWorkspaceRepo,
  type ProjectedRestoredWorkspaceRepoRuntime,
  type RepoWorkspaceTabsRestoreResult,
  type RepoRuntimeProjection,
  type RestoredWorkspaceRepoRuntime,
  type WorkspaceRestoreResult,
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

export interface RestoreRepoTabsInput {
  userId: string
  clientId: string
  repoRoot: string
  repoRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

type OpenWorkspaceRepoResult = { kind: 'opened'; opened: OpenedWorkspaceRepo } | { kind: 'invalid' }
type WorkspaceTabsValidationResult = { ok: true } | { ok: false }

type OpenedWorkspaceRepo = RestoredWorkspaceRepoRuntime & {
  lease: RepoRuntimeMembershipLeaseEntry
}
type OpenedProjectedWorkspaceRepo = ProjectedRestoredWorkspaceRepoRuntime & {
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

export async function restoreServerWorkspace(input: RestoreServerWorkspaceInput): Promise<WorkspaceRestoreResult> {
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
      const openedByRoot = new Map<string, OpenedWorkspaceRepo>()
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
  | { kind: 'restored'; value: WorkspaceRestoreResult }
  | { kind: 'membership-conflict'; latestWorkspace: ServerWorkspaceState; repaired: boolean }

async function restoreServerWorkspaceSnapshot(
  input: RestoreServerWorkspaceInput,
  source: ServerWorkspaceState,
  openedByRoot: Map<string, OpenedWorkspaceRepo>,
): Promise<RestoreServerWorkspaceSnapshotOutcome> {
  input.signal?.throwIfAborted()
  let repoRestoreFailed = false
  const activeRepoRoot = input.activeRepoRoot ?? null
  reconcileOpenedRepoMemberships(input, source.openRepoEntries, openedByRoot)
  for (const entry of source.openRepoEntries) {
    if (openedByRoot.has(repoSessionEntryId(entry))) continue
    const result = await openWorkspaceRepo(input, entry, {
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

  const expectedMembership = membership.workspace.openRepoEntries
  const initializedTabs = await initializeWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    workspace: validatedWorkspace.workspace,
    repos: openedActive,
    confirmMembership: async () => await compareAndReplaceServerWorkspaceRepos(expectedMembership, expectedMembership),
  })
  if (!initializedTabs.matched) {
    return {
      kind: 'membership-conflict',
      latestWorkspace: initializedTabs.latestWorkspace,
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
        initializedTabs.snapshots,
      ),
    },
  }
}

function reconcileOpenedRepoMemberships(
  input: RestoreServerWorkspaceInput,
  entries: readonly RepoSessionEntry[],
  openedByRoot: Map<string, OpenedWorkspaceRepo>,
): void {
  const expectedByRoot = new Map(entries.map((entry) => [repoSessionEntryId(entry), entry]))
  for (const [repoRoot, opened] of openedByRoot) {
    const expected = expectedByRoot.get(repoRoot)
    if (expected && sameWorkspaceRepoEntry(opened.entry, expected)) continue
    releaseWorkspaceRepoRuntime(input, opened.lease)
    openedByRoot.delete(repoRoot)
  }
}

function sameWorkspaceRepoEntry(a: RepoSessionEntry, b: RepoSessionEntry): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === 'local' || b.kind === 'local') return true
  return (
    a.ref.id === b.ref.id &&
    a.ref.alias === b.ref.alias &&
    a.ref.remotePath === b.ref.remotePath &&
    a.ref.displayName === b.ref.displayName
  )
}

async function openWorkspaceRepo(
  input: RestoreServerWorkspaceInput,
  entry: RepoSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceRepoResult> {
  input.signal?.throwIfAborted()
  if (entry.kind === 'remote') return await openRemoteWorkspaceRepo(input, entry, options)
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
    // migrate non-canonical paths and lets workspace repair clean them.
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
    releaseWorkspaceRepoRuntime(input, lease)
    throw err
  }
}

async function openRemoteWorkspaceRepo(
  input: RestoreServerWorkspaceInput,
  entry: RemoteRepoSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceRepoResult> {
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
      releaseWorkspaceRepoRuntime(input, lease)
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
    releaseWorkspaceRepoRuntime(input, lease)
    throw err
  }
}

function localRepoStub(
  repoRoot: string,
  name: string | null | undefined,
  lease: RepoRuntimeMembershipLeaseEntry,
): OpenedWorkspaceRepo {
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
): OpenedWorkspaceRepo {
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
    onAbort = () => reject(signal.reason ?? new Error('workspace restore aborted'))
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
): WorkspaceTabsValidationResult {
  const openedByRoot = openedRepoByRoot(opened)
  for (const [repoRoot, tabsByTarget] of Object.entries(workspace.workspacePaneTabsByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    // Stub leases (non-active repos at cold start) carry `projection: null`
    // and their tabs will be restored lazily. Defer validation to the lazy
    // path; do not force workspace repair.
    if (!repo) continue
    for (const targetKey of Object.keys(tabsByTarget)) {
      if (!targetForWorkspaceKey(repo, targetKey)) return { ok: false }
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
  const repo = await projectWorkspaceRepo(input, entry)
  if (!repo) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
  }

  const membership = await confirmServerWorkspaceRepoEntry(entry)
  if (!membership.matched) throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  const validatedWorkspace = await validateOrRepairWorkspacePaneTabs(membership.workspace, repo, entry)
  if (validatedWorkspace.kind === 'membership-conflict') {
    throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  }
  const initializedTabs = await initializeWorkspacePaneTabsWithMembershipGuard({
    restoreInput: {
      userId: input.userId,
      clientId: input.clientId,
      workspacePaneTabsHost: input.workspacePaneTabsHost,
      signal: input.signal,
    },
    workspace: validatedWorkspace.workspace,
    repos: [repo],
    confirmMembership: async () => await confirmServerWorkspaceRepoEntry(entry),
    assertCurrent: () => assertCurrentRepoRuntimeMembership(input),
  })
  if (!initializedTabs.matched) {
    throw new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
  }
  return {
    repo,
    snapshot: initializedTabs.snapshots[0]?.snapshot ?? null,
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
    if (!currentEntry || !sameWorkspaceRepoEntry(currentEntry, expectedRepoEntry)) {
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

async function projectWorkspaceRepo(
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

function isOpenedProjectedRepo(repo: OpenedWorkspaceRepo): repo is OpenedProjectedWorkspaceRepo {
  return isProjectedRestoredWorkspaceRepo(repo)
}

type WorkspaceMembershipConfirmation =
  { matched: true; workspace: ServerWorkspaceState } | { matched: false; latestWorkspace: ServerWorkspaceState }

async function initializeWorkspacePaneTabsWithMembershipGuard(input: {
  restoreInput: RestoreServerWorkspaceInput
  workspace: ServerWorkspaceState
  repos: ProjectedRestoredWorkspaceRepoRuntime[]
  confirmMembership: () => Promise<WorkspaceMembershipConfirmation>
  assertCurrent?: () => void
}): Promise<
  | {
      matched: true
      snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>
    }
  | { matched: false; latestWorkspace: ServerWorkspaceState }
> {
  const confirmed = await input.confirmMembership()
  if (!confirmed.matched) return confirmed
  const stableWorkspace = {
    ...input.workspace,
    openRepoEntries: confirmed.workspace.openRepoEntries,
  }
  input.restoreInput.signal?.throwIfAborted()
  const snapshots = await restoreWorkspacePaneTabsForRepos(input.restoreInput, stableWorkspace, input.repos)
  input.assertCurrent?.()
  input.restoreInput.signal?.throwIfAborted()
  const committed = await input.confirmMembership()
  if (!committed.matched) return committed
  return { matched: true, snapshots }
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
      const target = targetForWorkspaceKey(repo, targetKey)
      if (!target) continue
      replacements.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, target, tabs })
    }
  }
  return replacements
}

function targetForWorkspaceKey(
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
  opened: OpenedWorkspaceRepo[],
): string | null {
  if (activeRepoRoot && opened.some((repo) => repo.repoRoot === activeRepoRoot)) return activeRepoRoot
  return opened[0]?.repoRoot ?? null
}

function openedRepoByRoot<T extends RestoredWorkspaceRepoRuntime>(opened: T[]): Map<string, T> {
  return new Map(opened.map((repo) => [repo.repoRoot, repo]))
}

function runtimeSnapshotFromOpened(
  opened: OpenedWorkspaceRepo[],
  restoredRepoId: string | null,
  workspacePaneTabs: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>,
): WorkspaceRuntimeRestoreSnapshot {
  return {
    repos: opened.map(({ lease: _lease, ...repo }) => repo),
    workspacePaneTabs,
    restoredRepoId,
  }
}

function releaseOpenedRepoRuntimes(input: RestoreServerWorkspaceInput, opened: Iterable<OpenedWorkspaceRepo>): void {
  for (const repo of opened) releaseWorkspaceRepoRuntime(input, repo.lease)
}

function releaseWorkspaceRepoRuntime(input: RestoreServerWorkspaceInput, lease: RepoRuntimeMembershipLeaseEntry): void {
  releaseRepoRuntimeMembershipLease(input.userId, input.clientId, lease)
}

function lastPathSegment(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '')
  const segment = trimmed.split(/[\\/]/).pop()
  return segment || value
}
