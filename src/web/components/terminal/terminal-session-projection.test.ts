import { describe, expect, test } from 'vitest'
import {
  projectCreateResultForClient,
  projectServerTerminalSession,
  projectTerminalStartResultForClient,
} from '#/web/components/terminal/terminal-session-projection.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { runtimeWorkspacePaneTargetForTest } from '#/web/test-utils/workspace-pane-tabs.ts'

const REPO_ROOT = workspaceIdForTest('goblin+file:///example-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/example-repo'
const RUNTIME_TARGET = runtimeWorkspacePaneTargetForTest({
  kind: 'git-worktree' as const,
  workspaceId: REPO_ROOT,
  workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
  worktreePath: WORKTREE_PATH,
})

describe('terminal session projection helpers', () => {
  test('projects server session summaries into client hydration input', () => {
    const projected = projectServerTerminalSession({
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      clientId: 'client_a',
      index: 2,
      serverSession: {
        target: RUNTIME_TARGET,
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-222222222222222222222',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
        controller: { clientId: 'client_a', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: 'shell',
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
      },
    })

    expect(projected).toEqual({
      descriptor: {
        terminalSessionId: 'term-222222222222222222222',
        index: 2,
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
      },
      terminalWorktreeKey: `${REPO_ROOT}\0${REPO_ROOT}`,
      hydrateInput: {
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        processName: 'zsh',
        canonicalTitle: 'shell',
        phase: 'open',
        message: null,
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
        snapshot: null,
        snapshotSeq: 0,
        outputEra: 0,
      },
      controlsTerminal: true,
    })
  })

  test('uses null when the server snapshot is missing', () => {
    const projected = projectServerTerminalSession({
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      clientId: 'client_b',
      index: 1,
      serverSession: {
        target: RUNTIME_TARGET,
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
        controller: { clientId: 'client_a', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'error',
        message: 'pty failed',
        cols: 80,
        rows: 24,
      },
    })

    expect(projected?.hydrateInput.snapshot).toBeNull()
    expect(projected?.hydrateInput.snapshotSeq).toBe(0)
    expect(projected?.hydrateInput.role).toBe('viewer')
    expect(projected?.hydrateInput.controllerStatus).toBe('connected')
    expect(projected?.controlsTerminal).toBe(false)
  })

  test('rejects server sessions from a different workspace runtime', () => {
    const projected = projectServerTerminalSession({
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: 'repo-runtime-current',
      clientId: 'client_b',
      index: 1,
      serverSession: {
        target: RUNTIME_TARGET,
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
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

  test('uses server session presentation metadata', () => {
    const projected = projectServerTerminalSession({
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      clientId: 'client_b',
      index: 1,
      serverSession: {
        target: RUNTIME_TARGET,
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        presentation: {
          kind: 'git-worktree' as const,
          head: { kind: 'branch' as const, branchName: 'feature/restored' },
        },
        controller: null,
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
    })

    expect(projected?.descriptor.presentation).toEqual({
      kind: 'git-worktree' as const,
      head: { kind: 'branch' as const, branchName: 'feature/restored' },
    })
  })

  test('does not replace server presentation from a second client-side authority', () => {
    const projected = projectServerTerminalSession({
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      clientId: 'client_b',
      index: 1,
      serverSession: {
        target: RUNTIME_TARGET,
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/stale' } },
        controller: null,
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
    })

    expect(projected?.descriptor.presentation).toEqual({
      kind: 'git-worktree' as const,
      head: { kind: 'branch' as const, branchName: 'feature/stale' },
    })
  })

  test('projects attach results into local controller state for the active attachment', () => {
    const projected = projectTerminalStartResultForClient(
      {
        ok: true,
        frame: 'snapshot',
        terminalProjectionEffect: { kind: 'none' },
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
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

  test('materializes a prepared create projection with the committed canonical branch', () => {
    const projected = projectCreateResultForClient(
      {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/stale' } },
      },
      {
        ok: true,
        action: 'created',
        presentation: {
          kind: 'git-worktree' as const,
          head: { kind: 'branch' as const, branchName: 'feature/renamed' },
        },
        terminalSessionId: 'term-111111111111111111111',
        terminalProjectionEffect: { kind: 'delta', revision: 1 },
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSession).toEqual({
      terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/renamed' } },
      controller: { clientId: 'client_a', status: 'connected' },
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      cols: 120,
      rows: 40,
    })
  })

  test('uses authoritative create metadata for the projected session', () => {
    const projected = projectCreateResultForClient(
      {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
      },
      {
        ok: true,
        action: 'created',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
        terminalSessionId: 'term-111111111111111111111',
        terminalProjectionEffect: { kind: 'delta', revision: 1 },
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        processName: 'new-shell',
        canonicalTitle: 'new title',
        phase: 'open',
        message: null,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSession).toEqual(
      expect.objectContaining({
        terminalRuntimeSessionId: 'pty_session_123_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
        processName: 'new-shell',
        canonicalTitle: 'new title',
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
      }),
    )

    const recovered = projectServerTerminalSession({
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      clientId: 'client_a',
      index: 0,
      serverSession: projected.serverSession,
    })
    expect(recovered?.descriptor).toMatchObject({
      target: projected.serverSession.target,
      presentation: projected.serverSession.presentation,
    })
  })

  test('projects restored create metadata for the durable terminal session id', () => {
    const projected = projectCreateResultForClient(
      {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
      },
      {
        ok: true,
        action: 'restored',
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
        terminalSessionId: 'term-111111111111111111111',
        terminalProjectionEffect: { kind: 'delta', revision: 1 },
        terminalRuntimeSessionId: 'pty_session_new_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        processName: 'zsh',
        canonicalTitle: 'new-shell',
        phase: 'open',
        message: null,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
    )

    expect(projected.serverSession).toEqual(
      expect.objectContaining({
        terminalRuntimeSessionId: 'pty_session_new_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        processName: 'zsh',
        canonicalTitle: 'new-shell',
        cols: 120,
        rows: 40,
      }),
    )
  })
})
