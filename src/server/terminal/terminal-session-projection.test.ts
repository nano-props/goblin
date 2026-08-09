import { describe, expect, test } from 'vitest'
import type { TerminalBoundRuntimeMetadata, TerminalExecutionTarget } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  projectBoundTerminalRuntimeMetadata,
  projectTerminalRuntimeMetadata,
  projectTerminalSessionSummary,
  projectTerminalSnapshotAttachResult,
  projectTerminalStreamAttachResult,
  projectTerminalTakeoverResult,
} from '#/server/terminal/terminal-session-projection.ts'

const workspaceId = canonicalWorkspaceLocator('goblin+file:///workspace')
if (!workspaceId) throw new Error('invalid workspace fixture')

const target: TerminalExecutionTarget = {
  kind: 'git-worktree',
  workspaceId,
  workspaceRuntimeId: 'runtime-test',
  root: workspaceId,
}

function preparedSession() {
  return {
    id: 'pty-runtime-session',
    terminalSessionId: 'term-session',
    phase: 'opening' as const,
    message: null,
    ptyState: { kind: 'prepared' as const },
    target,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/test' } },
  }
}

describe('terminal session wire projection', () => {
  test('projects a prepared session without inventing a PTY binding', () => {
    const session = preparedSession()

    expect(projectTerminalRuntimeMetadata(session, null)).toEqual({
      terminalRuntimeSessionId: 'pty-runtime-session',
      terminalRuntimeGeneration: 0,
      identityRevision: 0,
      processName: 'terminal',
      canonicalTitle: null,
      phase: 'opening',
      message: null,
      controller: null,
      canonicalSize: null,
    })
    expect(projectTerminalSessionSummary(session, null)).toMatchObject({
      terminalSessionId: 'term-session',
      target,
      presentation: session.presentation,
    })
    expect(projectBoundTerminalRuntimeMetadata(session, null)).toBeNull()
    expect(projectTerminalTakeoverResult(session, null)).toEqual({ ok: false, message: 'error.unavailable' })
    expect(projectTerminalStreamAttachResult(session, null, 7)).toEqual({
      ok: false,
      message: 'error.unavailable',
    })
  })

  test('rejects a target and presentation mismatch at the wire boundary', () => {
    expect(() =>
      projectTerminalSessionSummary({ ...preparedSession(), presentation: { kind: 'workspace-root' as const } }, null),
    ).toThrow('terminal session target and presentation disagree')
  })

  test('builds a recovery frame from an accepted snapshot and bound metadata', () => {
    const metadata: TerminalBoundRuntimeMetadata = {
      terminalRuntimeSessionId: 'pty-runtime-session',
      terminalRuntimeGeneration: 2,
      identityRevision: 3,
      processName: 'shell',
      canonicalTitle: 'task',
      phase: 'open',
      message: null,
      controller: { clientId: 'client-test', status: 'connected' },
      canonicalSize: { cols: 100, rows: 30 },
    }

    expect(
      projectTerminalSnapshotAttachResult(
        { generation: 2, canonicalSize: metadata.canonicalSize, snapshot: 'screen', snapshotSeq: 9 },
        metadata,
      ),
    ).toEqual({
      ok: true,
      frame: 'snapshot',
      terminalProjectionEffect: { kind: 'none' },
      snapshot: 'screen',
      snapshotSeq: 9,
      ...metadata,
    })
  })
})
