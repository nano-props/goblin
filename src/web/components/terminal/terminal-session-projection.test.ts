import { describe, expect, test } from 'vitest'
import {
  projectServerTerminalSession,
  projectTerminalAttachResultForClient,
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
  test('projects server session summaries into client hydration input', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      clientId: 'client_a',
      serverSession: {
        ptySessionId: 'pty_session_123_aaaaaaaaa',
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0slot-2`,
        viewType: 'terminal',
        viewId: `${REPO_ROOT}\0${WORKTREE_PATH}\0slot-2`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_a', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: 'shell',
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
        displayOrder: 2,
      },
      serverSnapshot: { ptySessionId: 'pty_session_123_aaaaaaaaa', snapshot: 'server-snap', snapshotSeq: 9 },
    })

    expect(projected).toEqual({
      descriptor: {
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0slot-2`,
        worktreeTerminalKey: `${REPO_ROOT}\0${WORKTREE_PATH}`,
        slotId: 'slot-2',
        index: 2,
        repoRoot: REPO_ROOT,
        branch: 'main',
        worktreePath: WORKTREE_PATH,
      },
      worktreeTerminalKey: `${REPO_ROOT}\0${WORKTREE_PATH}`,
      hydrateInput: {
        ptySessionId: 'pty_session_123_aaaaaaaaa',
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
      controlsTerminal: true,
      displayOrder: 2,
    })
  })

  test('falls back to reattach snapshot cache only for matching session ids', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      clientId: 'client_b',
      serverSession: {
        ptySessionId: 'pty_session_123_aaaaaaaaa',
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`,
        viewType: 'terminal',
        viewId: `${REPO_ROOT}\0${WORKTREE_PATH}\0slot-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_a', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'error',
        message: 'pty failed',
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
      reattachSnapshot: { ptySessionId: 'pty_session_123_aaaaaaaaa', snapshot: 'cached-snap', snapshotSeq: 3 },
    })

    expect(projected?.hydrateInput.snapshot).toBe('cached-snap')
    expect(projected?.hydrateInput.snapshotSeq).toBe(3)
    expect(projected?.hydrateInput.role).toBe('viewer')
    expect(projected?.hydrateInput.controllerStatus).toBe('connected')
    expect(projected?.controlsTerminal).toBe(false)
  })

  test('projects attach results into local controller state for the active attachment', () => {
    const projected = projectTerminalAttachResultForClient(
      {
        ok: true,
        ptySessionId: 'pty_session_123_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 80,
        canonicalRows: 24,
      },
      'client_b',
    )

    expect(projected.role).toBe('viewer')
    expect(projected.controllerStatus).toBe('connected')
  })
})
