import {
  parseCanonicalWorkspaceLocator,
  type ParsedWorkspaceLocator,
  type WorkspaceId,
  workspaceLocatorForPath,
} from '#/shared/workspace-locator.ts'

export type WorkspaceUnavailableReason =
  | 'error.workspace-locator-malformed'
  | 'error.workspace-transport-unsupported'
  | 'error.workspace-path-not-found'
  | 'error.workspace-path-not-directory'
  | 'error.workspace-permission-denied'
  | 'error.workspace-transport-unavailable'

export type WorkspaceCapabilities = {
  files: { read: true; write: boolean }
  terminal: { available: boolean }
  git:
    | { status: 'unavailable' }
    | {
        status: 'available'
        worktrees: boolean
        pullRequests: { provider: 'github' } | { provider: 'none' }
      }
}

export type WorkspaceProbeState =
  | { status: 'probing' }
  | { status: 'ready'; name: string; capabilities: WorkspaceCapabilities; diagnostics: WorkspaceDiagnostic[] }
  | { status: 'unavailable'; reason: WorkspaceUnavailableReason }

export type WorkspaceSettledProbeState = Exclude<WorkspaceProbeState, { status: 'probing' }>
export type WorkspaceReadyProbeState = Extract<WorkspaceProbeState, { status: 'ready' }>
export type WorkspaceGitReadyProbeState = WorkspaceReadyProbeState & {
  capabilities: WorkspaceReadyProbeState['capabilities'] & {
    git: Extract<WorkspaceCapabilities['git'], { status: 'available' }>
  }
}
export type WorkspaceFilesystemReadyProbeState = WorkspaceReadyProbeState & {
  capabilities: WorkspaceReadyProbeState['capabilities'] & {
    git: Extract<WorkspaceCapabilities['git'], { status: 'unavailable' }>
  }
}

export type WorkspaceRefreshResult =
  | { kind: 'committed'; probe: WorkspaceSettledProbeState }
  | { kind: 'failed'; probe: WorkspaceSettledProbeState }
  | { kind: 'stale-runtime' }

export type WorkspaceDiagnostic = {
  scope: 'git' | 'transport'
  message: string
}

export type WorkspaceRuntime = {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  locator: ParsedWorkspaceLocator
  probe: WorkspaceProbeState
}

export type WorkspaceGitProbeResult =
  | {
      status: 'available'
      worktrees: boolean
      pullRequests: { provider: 'github' } | { provider: 'none' }
    }
  | { status: 'not-repository' }
  | { status: 'parent-only' }
  | { status: 'inconclusive'; diagnostic: string }

export type RestorableWorkspacePaneTarget =
  { kind: 'workspace-root' } | { kind: 'git-branch'; branch: string } | { kind: 'git-worktree'; root: WorkspaceId }

export type RuntimeWorkspacePaneTarget =
  | { kind: 'workspace-root'; workspaceId: WorkspaceId; workspaceRuntimeId: string }
  | { kind: 'git-branch'; workspaceId: WorkspaceId; workspaceRuntimeId: string; branch: string }
  | { kind: 'git-worktree'; workspaceId: WorkspaceId; workspaceRuntimeId: string; root: WorkspaceId }

/** Runtime targets that authorize operations against a concrete filesystem root. */
export type WorkspacePaneFilesystemExecutionTarget = Exclude<RuntimeWorkspacePaneTarget, { kind: 'git-branch' }>

export function workspacePaneFilesystemExecutionPath(target: WorkspacePaneFilesystemExecutionTarget): string {
  const locator = parseCanonicalWorkspaceLocator(target.kind === 'workspace-root' ? target.workspaceId : target.root)
  if (!locator) throw new Error('filesystem execution target locator is invalid')
  return locator.path
}

export function gitWorktreeFilesystemExecutionTarget(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  worktreePath: string,
): WorkspacePaneFilesystemExecutionTarget | null {
  const root = workspaceLocatorForPath(workspaceId, worktreePath)
  return root ? { kind: 'git-worktree', workspaceId, workspaceRuntimeId, root } : null
}

export function capabilitiesFromGitProbe(
  git: WorkspaceGitProbeResult,
  directory: { write: boolean; terminal: boolean },
): WorkspaceCapabilities {
  return {
    files: { read: true, write: directory.write },
    terminal: { available: directory.terminal },
    git:
      git.status === 'available'
        ? {
            status: 'available',
            worktrees: git.worktrees,
            pullRequests: git.pullRequests,
          }
        : { status: 'unavailable' },
  }
}

export function workspaceGitAvailable(
  probe: WorkspaceProbeState | null | undefined,
): probe is WorkspaceGitReadyProbeState {
  return probe?.status === 'ready' && probe.capabilities.git.status === 'available'
}

export function workspaceGitUnavailable(
  probe: WorkspaceProbeState | null | undefined,
): probe is WorkspaceFilesystemReadyProbeState {
  return probe?.status === 'ready' && probe.capabilities.git.status === 'unavailable'
}

export function workspaceTerminalAvailable(probe: WorkspaceProbeState | null | undefined): boolean {
  return probe?.status === 'ready' && probe.capabilities.terminal.available
}

export function workspaceWorktreesAvailable(probe: WorkspaceProbeState | null | undefined): boolean {
  return probe?.status === 'ready' && probe.capabilities.git.status === 'available' && probe.capabilities.git.worktrees
}

export function bindWorkspacePaneTarget(
  target: RestorableWorkspacePaneTarget,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): RuntimeWorkspacePaneTarget {
  return target.kind === 'workspace-root'
    ? { kind: 'workspace-root', workspaceId, workspaceRuntimeId }
    : { ...target, workspaceId, workspaceRuntimeId }
}

export function sameWorkspaceProbeState(a: WorkspaceProbeState, b: WorkspaceProbeState): boolean {
  if (a.status !== b.status) return false
  if (a.status === 'probing' || b.status === 'probing') return true
  if (a.status === 'unavailable' || b.status === 'unavailable') {
    return a.status === 'unavailable' && b.status === 'unavailable' && a.reason === b.reason
  }
  return (
    a.name === b.name &&
    a.capabilities.files.write === b.capabilities.files.write &&
    a.capabilities.terminal.available === b.capabilities.terminal.available &&
    sameGitCapability(a.capabilities.git, b.capabilities.git) &&
    a.diagnostics.length === b.diagnostics.length &&
    a.diagnostics.every(
      (diagnostic, index) =>
        diagnostic.scope === b.diagnostics[index]?.scope && diagnostic.message === b.diagnostics[index]?.message,
    )
  )
}

function sameGitCapability(a: WorkspaceCapabilities['git'], b: WorkspaceCapabilities['git']): boolean {
  if (a.status !== b.status) return false
  return (
    a.status === 'unavailable' ||
    (b.status === 'available' && a.worktrees === b.worktrees && a.pullRequests.provider === b.pullRequests.provider)
  )
}
