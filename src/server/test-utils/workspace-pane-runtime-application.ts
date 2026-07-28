import { vi } from 'vitest'
import type { ServerTerminalCreateResult } from '#/server/terminal/terminal-session-creator.ts'
import type { WorkspacePaneRuntimeTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { terminalGitWorktreePresentation, type TerminalCreateResult } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

function requiredWorkspaceLocator(value: string) {
  const locator = canonicalWorkspaceLocator(value)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

export const workspaceId = requiredWorkspaceLocator('goblin+file:///repo')
export const worktreeRoot = requiredWorkspaceLocator('goblin+file:///repo/worktree')
export const otherWorktreeRoot = requiredWorkspaceLocator('goblin+file:///repo/other-worktree')

export const request = {
  workspaceId,
  workspaceRuntimeId: 'repo-runtime-test',
  branch: 'main',
  worktreePath: '/repo/worktree',
  target: { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: 'repo-runtime-test', root: worktreeRoot },
  kind: 'primary' as const,
  clientId: 'client-test',
}

export const paneTabsSnapshot = { revision: 1, entries: [] }

export function runtimeTabsCoordinator(
  overrides: Partial<WorkspacePaneRuntimeTabsCoordinator> = {},
): WorkspacePaneRuntimeTabsCoordinator {
  return {
    ensureRuntimeTabForSession: vi.fn(async () => {
      throw new Error('ensureRuntimeTabForSession must be explicitly overridden by the test')
    }),
    reconcileWorktreeAdmitted: vi.fn(async () => {
      throw new Error('reconcileWorktreeAdmitted must be explicitly overridden by the test')
    }),
    ...overrides,
  }
}

export function terminalCreateSuccess(
  action: 'created' | 'restored' | 'reused' = 'created',
): Extract<ServerTerminalCreateResult, { ok: true }> {
  const terminalRuntimeSessionId = 'pty_session_1_aaaaaaaaa'
  const terminalSessionId = 'term-111111111111111111111'
  return {
    ok: true,
    terminalSessionId,
    admission: {
      kind: 'existing',
      commit: vi.fn(({ presentation }) => committedTerminalResult(action, presentation)),
      publishCommittedEffects: vi.fn(),
      abort: vi.fn(),
    },
    terminalRuntimeSessionId,
  }
}

function committedTerminalResult(
  action: 'created' | 'restored' | 'reused',
  presentation = terminalGitWorktreePresentation(request.branch),
) {
  return {
    action,
    presentation,
    terminalProjectionEffect: { kind: 'delta' as const, revision: 1 },
    terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
    terminalRuntimeGeneration: 0,
    identityRevision: 0,
    processName: '',
    canonicalTitle: null,
    phase: 'opening' as const,
    message: null,
    controller: null,
    canonicalSize: null,
  }
}

export function publishedTerminalResult(
  runtime: Extract<ServerTerminalCreateResult, { ok: true }>,
  canonicalBranch = request.branch,
): Extract<TerminalCreateResult, { ok: true }> {
  return {
    ok: true,
    terminalSessionId: runtime.terminalSessionId,
    ...committedTerminalResult('created', terminalGitWorktreePresentation(canonicalBranch)),
  }
}

export function terminalSession(terminalSessionId: string, terminalRuntimeSessionId: string) {
  return {
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    identityRevision: 0,
    terminalSessionId,
    target: request.target,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: request.branch } },
    nativeWorktreePath: request.worktreePath,
    controller: { clientId: 'client-test', status: 'connected' as const },
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    canonicalSize: { cols: 100, rows: 30 },
  }
}

export function deferred<T>() {
  return Promise.withResolvers<T>()
}
