import { describe, expect, test } from 'vitest'
import {
  projectServerTerminalSession,
  projectTerminalAttachResultForAttachment,
} from '#/web/components/terminal/terminal-session-projection.ts'
import type { TerminalRepoIndex } from '#/web/components/terminal/types.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo'

function makeRepoIndex(): TerminalRepoIndex {
  return {
    [REPO_ROOT]: {
      instanceToken: 1,
      branchByWorktreePath: { [WORKTREE_PATH]: 'main' },
    },
  }
}

describe('terminal session projection helpers', () => {
  test('projects server session summaries into renderer hydration input', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      attachmentId: 'attachment_a',
      serverSession: {
        sessionId: 'session_123',
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-2`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: 'shell',
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
        displayOrder: 2,
      },
      serverSnapshot: { sessionId: 'session_123', snapshot: 'server-snap', snapshotSeq: 9 },
    })

    expect(projected).toEqual({
      descriptor: {
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-2`,
        worktreeTerminalKey: `${REPO_ROOT}\0${WORKTREE_PATH}`,
        terminalId: 'terminal-2',
        index: 2,
        repoRoot: REPO_ROOT,
        branch: 'main',
        worktreePath: WORKTREE_PATH,
      },
      worktreeTerminalKey: `${REPO_ROOT}\0${WORKTREE_PATH}`,
      hydrateInput: {
        sessionId: 'session_123',
        processName: 'zsh',
        canonicalTitle: 'shell',
        phase: 'open',
        message: null,
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
        snapshot: 'server-snap',
        snapshotSeq: 9,
      },
      controlsAttachment: true,
      displayOrder: 2,
    })
  })

  test('falls back to reattach snapshot cache only for matching session ids', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      attachmentId: 'attachment_b',
      serverSession: {
        sessionId: 'session_123',
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_a', status: 'grace' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'error',
        message: 'pty failed',
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
      reattachSnapshot: { sessionId: 'session_123', snapshot: 'cached-snap', snapshotSeq: 3 },
    })

    expect(projected?.hydrateInput.snapshot).toBe('cached-snap')
    expect(projected?.hydrateInput.snapshotSeq).toBe(3)
    expect(projected?.hydrateInput.role).toBe('viewer')
    expect(projected?.hydrateInput.controllerStatus).toBe('grace')
    expect(projected?.controlsAttachment).toBe(false)
  })

  test('projects attach results into local ownership for the active attachment', () => {
    const projected = projectTerminalAttachResultForAttachment(
      {
        ok: true,
        sessionId: 'session_123',
        replay: '',
        replaySeq: 0,
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        canonicalCols: 80,
        canonicalRows: 24,
      },
      'attachment_b',
    )

    expect(projected.role).toBe('viewer')
    expect(projected.controllerStatus).toBe('connected')
  })
})
