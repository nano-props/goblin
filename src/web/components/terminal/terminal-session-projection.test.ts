import { describe, expect, test } from 'vitest'
import {
  projectCreateResultForClient,
  projectServerTerminalSession,
  projectTerminalAttachResultForClient,
} from '#/web/components/terminal/terminal-session-projection.ts'
import type { TerminalRepoIndex } from '#/web/components/terminal/types.ts'

const REPO_ROOT = '/repo'
const REPO_INSTANCE_ID = 'repo-instance-test'
const WORKTREE_PATH = '/repo'

function makeRepoIndex(): TerminalRepoIndex {
  return {
    [REPO_ROOT]: {
      instanceId: 'repo-instance-test',
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
      index: 2,
      serverSession: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'session-2',
        repoInstanceId: REPO_INSTANCE_ID,
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
      },
    })

    expect(projected).toEqual({
      descriptor: {
        terminalSessionId: 'session-2',
        terminalWorktreeKey: `${REPO_ROOT}\0${WORKTREE_PATH}`,
        index: 2,
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
      },
      controlsTerminal: true,
    })
  })

  test('uses an empty snapshot when the server snapshot is missing', () => {
    const projected = projectServerTerminalSession({
      repoIndex: makeRepoIndex(),
      repoRoot: REPO_ROOT,
      clientId: 'client_b',
      index: 1,
      serverSession: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'session-1',
        repoInstanceId: REPO_INSTANCE_ID,
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

  test('uses server session branch metadata when the repo branch index is not loaded', () => {
    const projected = projectServerTerminalSession({
      repoIndex: {
        [REPO_ROOT]: {
          instanceId: REPO_INSTANCE_ID,
          branchByWorktreePath: {},
        },
      },
      repoRoot: REPO_ROOT,
      clientId: 'client_b',
      index: 1,
      serverSession: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'session-1',
        repoInstanceId: REPO_INSTANCE_ID,
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

  test('materializes create projection from first-frame payload when sessions list lags', () => {
    const projected = projectCreateResultForClient(
      { repoRoot: REPO_ROOT, repoInstanceId: REPO_INSTANCE_ID, branch: 'main', worktreePath: WORKTREE_PATH },
      {
        ok: true,
        action: 'created',
        terminalSessionId: 'session-1',
        tabs: [],
        sessions: [],
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        snapshot: 'first-frame',
        snapshotSeq: 3,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSessions).toEqual([
      {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'session-1',
        repoInstanceId: REPO_INSTANCE_ID,
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
      },
    ])
    expect(projected.snapshotByTerminalRuntimeSessionId.get('pty_session_123_aaaaaaaaa')).toEqual({
      terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
      snapshot: 'first-frame',
      snapshotSeq: 3,
    })
  })

  test('uses authoritative create first-frame metadata when sessions projection already includes the target', () => {
    const existingSession = {
      terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
      terminalSessionId: 'session-1',
      repoInstanceId: REPO_INSTANCE_ID,
      repoRoot: '/server/repo',
      branch: 'server/main',
      worktreePath: '/server/repo/worktree',
      cwd: '/server/repo/worktree/subdir',
      controller: { clientId: 'client_a', status: 'connected' as const },
      processName: 'old-shell',
      canonicalTitle: 'old title',
      phase: 'opening' as const,
      message: 'old message',
      cols: 80,
      rows: 24,
    }

    const projected = projectCreateResultForClient(
      { repoRoot: REPO_ROOT, repoInstanceId: REPO_INSTANCE_ID, branch: 'main', worktreePath: WORKTREE_PATH },
      {
        ok: true,
        action: 'created',
        terminalSessionId: 'session-1',
        tabs: [],
        sessions: [existingSession],
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        processName: 'new-shell',
        canonicalTitle: 'new title',
        phase: 'open',
        message: null,
        snapshot: '',
        snapshotSeq: 0,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSessions).toEqual([
      {
        ...existingSession,
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalSessionId: 'session-1',
        processName: 'new-shell',
        canonicalTitle: 'new title',
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
      },
    ])
  })

  test('replaces stale create projection entry for the same terminal session id', () => {
    const staleSession = {
      terminalRuntimeSessionId: 'pty_session_old_aaaaaaaaa',
      terminalSessionId: 'session-1',
      repoInstanceId: REPO_INSTANCE_ID,
      repoRoot: REPO_ROOT,
      branch: 'main',
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      controller: { clientId: 'client_old', status: 'connected' as const },
      processName: 'old-shell',
      canonicalTitle: null,
      phase: 'open' as const,
      message: null,
      cols: 80,
      rows: 24,
    }

    const projected = projectCreateResultForClient(
      { repoRoot: REPO_ROOT, repoInstanceId: REPO_INSTANCE_ID, branch: 'main', worktreePath: WORKTREE_PATH },
      {
        ok: true,
        action: 'restored',
        terminalSessionId: 'session-1',
        tabs: [],
        sessions: [staleSession],
        terminalRuntimeSessionId: 'pty_session_new_aaaaaaaaa',
        processName: 'zsh',
        canonicalTitle: 'new-shell',
        phase: 'open',
        message: null,
        snapshot: 'restored-frame',
        snapshotSeq: 4,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: 'pty_session_new_aaaaaaaaa',
        terminalSessionId: 'session-1',
        processName: 'zsh',
        canonicalTitle: 'new-shell',
        cols: 120,
        rows: 40,
      }),
    ])
  })
})
