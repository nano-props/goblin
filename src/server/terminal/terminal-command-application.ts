import { homedir } from 'node:os'
import path from 'node:path'
import type { GoblinServerCommandResult } from '#/shared/g-command.ts'
import { tildifyPath } from '#/shared/paths.ts'
import {
  terminalExecutionPath,
  terminalSessionCoordinates,
  type TerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { workspaceGitAvailable, workspaceGitUnavailable } from '#/shared/workspace-runtime.ts'
import { parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTargetMembership, WorkspacePaneWorktreeTargetIdentity } from '#/shared/git-types.ts'
import { CodedError } from '#/shared/coded-error.ts'
import { getWorkspacePaneTargetMembership } from '#/server/repos/read-paths.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { workspaceProbeStateForRuntime } from '#/server/workspaces/runtime/authority.ts'
import type { ServerTerminalCommandHost, TerminalCommandHostResult } from '#/server/terminal/terminal-command-host.ts'

interface TerminalCommandManager {
  getSessionSummaryForDurableId(userId: string, terminalSessionId: string): TerminalSessionSummary | null
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
  closeSessionForUserOutcome(
    userId: string,
    terminalRuntimeSessionId: string,
  ): Promise<{ kind: 'closed' | 'already-closed' | 'failed' }>
}

interface TerminalCommandApplicationDependencies {
  manager: TerminalCommandManager
  workspaceProbe?: typeof workspaceProbeStateForRuntime
  readMembership?: typeof getWorkspacePaneTargetMembership
  homeDir?: string
}

type TargetMembershipProjection =
  { kind: 'ready'; membership: WorkspacePaneTargetMembership } | { kind: 'filesystem' } | { kind: 'unknown' }

interface TerminalCommandSession {
  terminalSessionId: string
  terminalRuntimeSessionId: string
  current: boolean
  title: string | null
  processName: string
  phase: TerminalSessionSummary['phase']
  targetLabel: string
  path: string
  availability: 'available' | 'orphaned' | 'unknown'
}

export function createTerminalCommandApplication(
  dependencies: TerminalCommandApplicationDependencies,
): ServerTerminalCommandHost {
  const probeWorkspace = dependencies.workspaceProbe ?? workspaceProbeStateForRuntime
  const readMembership = dependencies.readMembership ?? getWorkspacePaneTargetMembership
  const homeDir = dependencies.homeDir ?? homedir()

  async function inspect(
    userId: string,
    terminalSessionId: string,
    signal?: AbortSignal,
  ): Promise<TerminalCommandHostResult<{ sessions: TerminalCommandSession[] }>> {
    signal?.throwIfAborted()
    const current = dependencies.manager.getSessionSummaryForDurableId(userId, terminalSessionId)
    if (!current) return { ok: false, message: 'current Goblin terminal is no longer available' }
    const coordinates = terminalSessionCoordinates(current)
    const scope = terminalSessionRuntimeScope(coordinates.workspaceId, coordinates.workspaceRuntimeId)
    const [sessions, membership] = await Promise.all([
      dependencies.manager.listSessionsForUser(userId, scope),
      readTargetMembershipProjection(userId, coordinates.workspaceId, coordinates.workspaceRuntimeId, signal),
    ])
    return {
      ok: true,
      value: {
        sessions: sessions.map((session) =>
          projectSession(session, session.terminalSessionId === terminalSessionId, membership, homeDir),
        ),
      },
    }
  }

  async function readTargetMembershipProjection(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    signal?: AbortSignal,
  ): Promise<TargetMembershipProjection> {
    const probe = probeWorkspace(userId, workspaceId, workspaceRuntimeId)
    if (workspaceGitUnavailable(probe)) return { kind: 'filesystem' }
    if (!workspaceGitAvailable(probe)) return { kind: 'unknown' }
    try {
      return {
        kind: 'ready',
        membership: await readMembership(workspaceId, { workspaceRuntimeId, signal }),
      }
    } catch {
      signal?.throwIfAborted()
      return { kind: 'unknown' }
    }
  }

  return {
    async execute(userId, terminalSessionId, args, signal) {
      const action = terminalAction(args)
      if (!action) {
        throw new CodedError({
          code: 'BAD_REQUEST',
          message: "expected 'g term', 'g term list', or 'g term prune'",
        })
      }
      const inspected = await inspect(userId, terminalSessionId, signal)
      if (!inspected.ok) return inspected
      if (action === 'current') {
        const session = inspected.value.sessions.find((candidate) => candidate.current)
        return session
          ? commandOutput(formatCurrent(session))
          : { ok: false, message: 'current Goblin terminal is no longer available' }
      }
      if (action === 'list') return commandOutput(formatList(inspected.value.sessions))
      if (inspected.value.sessions.some((session) => session.availability === 'unknown')) {
        return { ok: false, message: 'worktree state is unavailable; no terminals were closed' }
      }
      const orphaned = inspected.value.sessions.filter((session) => session.availability === 'orphaned')
      const closed: TerminalCommandSession[] = []
      const failed: TerminalCommandSession[] = []
      signal?.throwIfAborted()
      // The caller is intentionally not exempt: `prune` means every orphan terminal.
      // If the current terminal is orphaned, closing its PTY can prevent this command's
      // response from being printed. That rare out-of-band case is accepted instead of
      // adding delayed retirement, retries, or a second completion protocol.
      for (const session of orphaned) {
        const outcome = await dependencies.manager.closeSessionForUserOutcome(userId, session.terminalRuntimeSessionId)
        if (outcome.kind === 'failed') failed.push(session)
        else closed.push(session)
      }
      const summary = `Pruned ${closed.length} orphan terminal${closed.length === 1 ? '' : 's'}.`
      return failed.length === 0
        ? commandOutput(summary)
        : {
            ok: false,
            message: `${summary} Failed to close ${failed.length} orphan terminal${failed.length === 1 ? '' : 's'}.`,
          }
    },
  }
}

function terminalAction(args: readonly string[]): 'current' | 'list' | 'prune' | null {
  if (args.length === 0) return 'current'
  if (args.length === 1 && (args[0] === 'list' || args[0] === 'prune')) return args[0]
  return null
}

function commandOutput(output: string): TerminalCommandHostResult<GoblinServerCommandResult> {
  return { ok: true, value: { output } }
}

function projectSession(
  session: TerminalSessionSummary,
  current: boolean,
  projection: TargetMembershipProjection,
  homeDir: string,
): TerminalCommandSession {
  const executionPath = terminalExecutionPath(session.target)
  const worktree =
    projection.kind !== 'ready'
      ? undefined
      : session.target.kind === 'workspace-root'
        ? projection.membership.source.kind === 'worktree'
          ? projection.membership.source.identity
          : undefined
        : projection.membership.linkedWorktrees.find((candidate) => candidate.worktreePath === executionPath)
  const availability =
    projection.kind === 'unknown'
      ? 'unknown'
      : projection.kind === 'filesystem'
        ? session.target.kind === 'workspace-root'
          ? 'available'
          : 'orphaned'
        : worktree
          ? 'available'
          : 'orphaned'
  const workspace = parseCanonicalWorkspaceLocator(terminalSessionCoordinates(session).workspaceId)
  if (!workspace) throw new Error('terminal workspace locator is invalid')
  return {
    terminalSessionId: session.terminalSessionId,
    terminalRuntimeSessionId: session.terminalRuntimeSessionId,
    current,
    title: session.canonicalTitle,
    processName: session.processName,
    phase: session.phase,
    targetLabel: targetLabel(projection, worktree, executionPath),
    path: workspace.transport === 'file' ? tildifyPath(executionPath, homeDir) : executionPath,
    availability,
  }
}

function targetLabel(
  projection: TargetMembershipProjection,
  worktree: WorkspacePaneWorktreeTargetIdentity | undefined,
  executionPath: string,
): string {
  if (projection.kind === 'filesystem') return 'workspace root'
  return worktree?.head.kind === 'branch'
    ? worktree.head.branchName
    : worktree
      ? 'detached'
      : path.basename(executionPath) || executionPath
}

function formatCurrent(session: TerminalCommandSession): string {
  return [
    `Terminal:     ${session.terminalSessionId}`,
    `Runtime:      ${session.terminalRuntimeSessionId}`,
    `Title:        ${oneLine(session.title ?? '-')}`,
    `Process:      ${oneLine(session.processName)}`,
    `Phase:        ${session.phase}`,
    `Target:       ${oneLine(session.targetLabel)}`,
    `Path:         ${oneLine(session.path)}`,
    `Availability: ${session.availability}`,
  ].join('\n')
}

function formatList(sessions: readonly TerminalCommandSession[]): string {
  if (sessions.length === 0) return 'No Goblin terminals.'
  const rows = sessions.map((session) => [
    session.current ? '*' : '',
    session.terminalSessionId,
    oneLine(session.title ?? session.processName),
    session.phase,
    session.availability,
    oneLine(session.targetLabel),
    oneLine(session.path),
  ])
  const headings = ['CURRENT', 'ID', 'TITLE', 'PHASE', 'AVAILABILITY', 'TARGET', 'PATH']
  const widths = headings.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index]?.length ?? 0)),
  )
  return [headings, ...rows]
    .map((row) =>
      row
        .map((value, index) => value.padEnd(widths[index] ?? value.length))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}

function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}
