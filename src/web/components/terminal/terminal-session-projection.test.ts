import { describe, expect, test } from 'vitest'
import {
  projectCreateResultForClient,
  projectServerTerminalSession,
  projectTerminalAttachResultForClient,
} from '#/web/components/terminal/terminal-session-projection.ts'
import type { TerminalRepoIndex } from '#/web/components/terminal/types.ts'

const REPO_ROOT = '/repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/repo'

function makeRepoIndex(): TerminalRepoIndex {
  return {
    [REPO_ROOT]: {
      repoRuntimeId: 'repo-runtime-test',
      branchByWorktreePath: { [WORKTREE_PATH]: 'main' },
    },
  }
}

describe('terminal session projection helpers', () => {
  test('projects server session summaries into client hydration input', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      clientId: 'client_a',
      index: 2,
      serverSession: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'term-222222222222222222222',
        repoRuntimeId: REPO_RUNTIME_ID,
        repoRoot: REPO_ROOT,
        branch: 'main',
        worktreePath: WORKTREE_PATH,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_a', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: 'shell',
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
      },
      serverSnapshot: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        snapshot: 'server-snap',
        snapshotSeq: 9,
      outputEra: 0,
      },
    })

    expect(projected).toEqual({
      descriptor: {
        terminalSessionId: 'term-222222222222222222222',
        terminalWorktreeKey: `${REPO_ROOT}\0${WORKTREE_PATH}`,
        index: 2,
        repoRuntimeId: REPO_RUNTIME_ID,
        repoRoot: REPO_ROOT,
        branch: 'main',
        worktreePath: WORKTREE_PATH,
      },
      terminalWorktreeKey: `${REPO_ROOT}\0${WORKTREE_PATH}`,
      hydrateInput: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
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
      outputEra: 0,
      },
      controlsTerminal: true,
    })
  })

  test('uses an empty snapshot when the server snapshot is missing', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      clientId: 'client_b',
      index: 1,
      serverSession: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'term-111111111111111111111',
        repoRuntimeId: REPO_RUNTIME_ID,
        repoRoot: REPO_ROOT,
        branch: 'main',
        worktreePath: WORKTREE_PATH,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_a', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'error',
        message: 'pty failed',
        cols: 80,
        rows: 24,
      },
    })

    expect(projected?.hydrateInput.snapshot).toBe('')
    expect(projected?.hydrateInput.snapshotSeq).toBe(0)
    expect(projected?.hydrateInput.role).toBe('viewer')
    expect(projected?.hydrateInput.controllerStatus).toBe('connected')
    expect(projected?.controlsTerminal).toBe(false)
  })

  test('rejects server sessions from a different repo runtime', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      repoRuntimeId: 'repo-runtime-current',
      clientId: 'client_b',
      index: 1,
      serverSession: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'term-111111111111111111111',
        repoRuntimeId: REPO_RUNTIME_ID,
        repoRoot: REPO_ROOT,
        branch: 'main',
        worktreePath: WORKTREE_PATH,
        cwd: WORKTREE_PATH,
        controller: null,
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
    })

    expect(projected).toBeNull()
  })

  test('uses server session branch metadata when the repo branch index is not loaded', () => {
    const projected = projectServerTerminalSession({
      repoIndex: {
        [REPO_ROOT]: {
          repoRuntimeId: REPO_RUNTIME_ID,
          branchByWorktreePath: {},
        },
      },
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      clientId: 'client_b',
      index: 1,
      serverSession: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'term-111111111111111111111',
        repoRuntimeId: REPO_RUNTIME_ID,
        repoRoot: REPO_ROOT,
        branch: 'feature/restored',
        worktreePath: WORKTREE_PATH,
        cwd: WORKTREE_PATH,
        controller: null,
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
    })

    expect(projected?.descriptor.branch).toBe('feature/restored')
  })

  test('projects attach results into local controller state for the active attachment', () => {
    const projected = projectTerminalAttachResultForClient(
      {
        ok: true,
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
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

  test('materializes create projection from the first-frame payload', () => {
    const projected = projectCreateResultForClient(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID, branch: 'main', worktreePath: WORKTREE_PATH },
      {
        ok: true,
        action: 'created',
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        snapshot: 'first-frame',
        snapshotSeq: 3,
        outputEra: 0,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSession).toEqual({
      terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
      terminalSessionId: 'term-111111111111111111111',
      repoRuntimeId: REPO_RUNTIME_ID,
      repoRoot: REPO_ROOT,
      branch: 'main',
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      controller: { clientId: 'client_a', status: 'connected' },
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      cols: 120,
      rows: 40,
    })
    expect(projected.snapshotByTerminalRuntimeSessionId.get('pty_session_123_aaaaaaaaa')).toEqual({
      terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
      snapshot: 'first-frame',
      snapshotSeq: 3,
    outputEra: 0,
    })
  })

  test('uses authoritative create first-frame metadata for the projected session', () => {
    const projected = projectCreateResultForClient(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID, branch: 'main', worktreePath: WORKTREE_PATH },
      {
        ok: true,
        action: 'created',
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        processName: 'new-shell',
        canonicalTitle: 'new title',
        phase: 'open',
        message: null,
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSession).toEqual(
      expect.objectContaining({
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'term-111111111111111111111',
        repoRoot: REPO_ROOT,
        branch: 'main',
        worktreePath: WORKTREE_PATH,
        processName: 'new-shell',
        canonicalTitle: 'new title',
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
      }),
    )
  })

  test('projects restored create metadata for the durable terminal session id', () => {
    const projected = projectCreateResultForClient(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID, branch: 'main', worktreePath: WORKTREE_PATH },
      {
        ok: true,
        action: 'restored',
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_session_new_aaaaaaaaa',
        processName: 'zsh',
        canonicalTitle: 'new-shell',
        phase: 'open',
        message: null,
        snapshot: 'restored-frame',
        snapshotSeq: 4,
        outputEra: 0,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSession).toEqual(
      expect.objectContaining({
        terminalRuntimeSessionId: 'pty_session_new_aaaaaaaaa',
        terminalSessionId: 'term-111111111111111111111',
        processName: 'zsh',
        canonicalTitle: 'new-shell',
        cols: 120,
        rows: 40,
      }),
    )
  })
})
