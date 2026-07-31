import type {
  TerminalAttachResult,
  TerminalBoundRuntimeMetadata,
  TerminalController,
  TerminalExecutionTarget,
  TerminalPresentation,
  TerminalRuntimeMetadata,
  TerminalSessionPhase,
  TerminalSessionSummary,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import {
  terminalPtyBoundState,
  terminalPtyGeneration,
  terminalPtyIdentityRevision,
  terminalPtyProcessName,
  type TerminalPtyState,
} from '#/server/terminal/terminal-pty-state.ts'
import type { TerminalPtyRecoverySnapshot } from '#/server/terminal/terminal-session-pty-lifecycle.ts'

interface TerminalSessionProjectionSource {
  id: string
  phase: TerminalSessionPhase
  message: string | null
  ptyState: TerminalPtyState
  terminalSessionId: string
  target: TerminalExecutionTarget
  presentation: TerminalPresentation | null
}

interface TerminalTakeoverProjectionSource {
  id: string
  phase: TerminalSessionPhase
  ptyState: TerminalPtyState
}

interface TerminalRuntimeProjectionSource extends TerminalTakeoverProjectionSource {
  message: string | null
}

interface TerminalPresentationSource {
  presentation: TerminalPresentation | null
}

export function projectTerminalSessionSummary(
  session: TerminalSessionProjectionSource,
  controller: TerminalController | null,
): TerminalSessionSummary {
  const metadata = projectTerminalRuntimeMetadata(session, controller)
  const presentation = requiredTerminalPresentation(session)
  if (session.target.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
    return { ...metadata, terminalSessionId: session.terminalSessionId, target: session.target, presentation }
  }
  if (session.target.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
    return { ...metadata, terminalSessionId: session.terminalSessionId, target: session.target, presentation }
  }
  throw new Error('terminal session target and presentation disagree')
}

export function projectTerminalRuntimeMetadata(
  session: TerminalRuntimeProjectionSource,
  controller: TerminalController | null,
  processName: string = terminalPtyProcessName(session),
): TerminalRuntimeMetadata {
  const bound = terminalPtyBoundState(session)
  return {
    terminalRuntimeSessionId: session.id,
    terminalRuntimeGeneration: terminalPtyGeneration(session),
    identityRevision: terminalPtyIdentityRevision(session),
    processName,
    canonicalTitle: bound?.render.title ?? null,
    phase: session.phase,
    message: session.message,
    controller,
    canonicalSize: bound ? { cols: bound.cols, rows: bound.rows } : null,
  }
}

export function projectBoundTerminalRuntimeMetadata(
  session: TerminalRuntimeProjectionSource,
  controller: TerminalController | null,
  canonicalSize?: { cols: number; rows: number },
): TerminalBoundRuntimeMetadata | null {
  const metadata = projectTerminalRuntimeMetadata(session, controller)
  const size = canonicalSize ?? metadata.canonicalSize
  return size ? { ...metadata, canonicalSize: size } : null
}

export function projectTerminalTakeoverResult(
  session: TerminalTakeoverProjectionSource,
  controller: TerminalController | null,
): TerminalTakeoverResult {
  const bound = terminalPtyBoundState(session)
  if (!bound) return { ok: false, message: 'error.unavailable' }
  return {
    ok: true,
    terminalRuntimeSessionId: session.id,
    terminalRuntimeGeneration: bound.generation,
    identityRevision: terminalPtyIdentityRevision(session),
    role: 'controller',
    controllerStatus: 'connected',
    controller,
    canonicalSize: { cols: bound.cols, rows: bound.rows },
    phase: session.phase,
  }
}

export function projectTerminalStreamAttachResult(
  session: TerminalRuntimeProjectionSource,
  controller: TerminalController | null,
  projectionRevision: number,
): Extract<TerminalAttachResult, { ok: true; frame: 'stream' }> | { ok: false; message: string } {
  const metadata = projectBoundTerminalRuntimeMetadata(session, controller)
  if (!metadata || session.phase !== 'open') return { ok: false, message: 'error.unavailable' }
  return {
    ok: true,
    frame: 'stream',
    terminalProjectionEffect: { kind: 'delta', revision: projectionRevision },
    ...metadata,
    phase: 'open',
  }
}

export function projectTerminalSnapshotAttachResult(
  snapshot: TerminalPtyRecoverySnapshot,
  metadata: TerminalBoundRuntimeMetadata,
): Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> {
  return {
    ok: true,
    frame: 'snapshot',
    terminalProjectionEffect: { kind: 'none' },
    snapshot: snapshot.snapshot,
    snapshotSeq: snapshot.snapshotSeq,
    ...metadata,
  }
}

function requiredTerminalPresentation(session: TerminalPresentationSource): TerminalPresentation {
  if (!session.presentation) throw new Error('terminal session presentation unavailable')
  return session.presentation
}
