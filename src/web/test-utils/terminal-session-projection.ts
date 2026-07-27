import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import {
  TerminalSessionProjection,
  getTerminalSessionProjection,
  setTerminalSessionProjectionForTests,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type { TerminalDescriptor, TerminalRuntimeMembershipIndex } from '#/web/components/terminal/types.ts'
import type { TerminalSessionClosedEvent, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalClient } from '#/web/terminal.ts'
import { resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { runtimeMembershipIndexFromEntries } from '#/web/components/terminal/terminal-runtime-membership-index.ts'
import {
  requiredTerminalSession,
  terminalSessionProjectionAccess,
  terminalSessionRuntimeAccess,
} from '#/web/test-utils/terminal-session-projection-access.ts'

// Projection tests share one singleton lifecycle and canonical runtime binding fixture.
const hoistedWorkspacePaneRuntimeMocks = vi.hoisted(() => ({
  close: vi.fn(),
}))
const hoistedWorkspacePaneTabsCommitMocks = vi.hoisted(() => ({
  writeCanonicalSnapshot: vi.fn(() => true),
}))

vi.mock('#/web/workspace-pane/workspace-pane-runtime-client.ts', () => ({
  workspacePaneRuntimeClient: {
    close: hoistedWorkspacePaneRuntimeMocks.close,
  },
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-commit.ts', () => ({
  writeCanonicalWorkspacePaneTabsSnapshot: hoistedWorkspacePaneTabsCommitMocks.writeCanonicalSnapshot,
}))

export function workspaceIdFixture(input: string) {
  const workspaceId = canonicalWorkspaceLocator(input)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  return workspaceId
}

export const REPO_ROOT = workspaceIdFixture('goblin+file:///repo')
export const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
export const WORKTREE_PATH = '/repo'
export const BRANCH = 'main'
export const WORKTREE_KEY = formatTerminalFilesystemTargetKey(REPO_ROOT, REPO_ROOT)
export const WORKSPACE_ID = requiredWorkspaceLocator(REPO_ROOT)
export const RUNTIME_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: WORKSPACE_ID,
  workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
  root: WORKSPACE_ID,
}

export function sessionClosedEvent(
  terminalRuntimeSessionId: string,
  terminalRuntimeGeneration: number,
  terminalSessionId: string,
  tabsBeforeRetirement: WorkspacePaneTabEntry[] | null = null,
): TerminalSessionClosedEvent {
  return {
    terminalRuntimeSessionId,
    terminalRuntimeGeneration,
    terminalSessionId,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    tabsBeforeRetirement,
  }
}

export function tabsBeforeRetirement(terminalSessionId: string) {
  return [
    { type: 'files' as const, tabId: 'workspace-pane:files' as const },
    { type: 'terminal' as const, runtimeSessionId: terminalSessionId },
  ]
}

export function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

export function makeDescriptor(terminalSessionId: string, index: number): TerminalDescriptor {
  return {
    terminalSessionId,
    index,
    target: RUNTIME_TARGET,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
  }
}

export function makeRuntimeMembershipIndex(workspaceRuntimeId = WORKSPACE_RUNTIME_ID): TerminalRuntimeMembershipIndex {
  return runtimeMembershipIndexFromEntries([{ id: REPO_ROOT, workspaceRuntimeId }])
}

export function makeServerSession(
  terminalRuntimeSessionId: string,
  terminalSessionId: string,
  overrides: Partial<{
    terminalRuntimeGeneration: number
    identityRevision: number
    controller: { clientId: string; status: 'connected' }
    processName: string
    canonicalTitle: string | null
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    canonicalSize: { cols: number; rows: number } | null
    workspaceRuntimeId: string
  }> = {},
): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: overrides.terminalRuntimeGeneration ?? 1,
    identityRevision: overrides.identityRevision ?? 0,
    terminalSessionId,
    target: { ...RUNTIME_TARGET, workspaceRuntimeId: overrides.workspaceRuntimeId ?? WORKSPACE_RUNTIME_ID },
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    controller: overrides.controller ?? null,
    processName: overrides.processName ?? 'bash',
    canonicalTitle: overrides.canonicalTitle ?? null,
    phase: overrides.phase ?? 'open',
    message: overrides.message ?? null,
    canonicalSize: overrides.canonicalSize ?? { cols: 80, rows: 24 },
  }
}

export function successfulRuntimeCloseSnapshot(
  terminalSessionId = 'term-111111111111111111111',
  terminalRuntimeSessionId: string | null = 'pty_session_1_aaaaaaaaa',
) {
  return {
    ok: true as const,
    runtimeType: 'terminal' as const,
    paneTabsSnapshot: { revision: 7, entries: [] },
    runtime:
      terminalRuntimeSessionId === null
        ? { action: 'already-closed' as const, terminalSessionId }
        : {
            action: 'closed' as const,
            terminalSessionId,
            terminalRuntimeSessionId,
            terminalRuntimeGeneration: 1,
          },
  }
}

export const workspacePaneRuntimeMocks = hoistedWorkspacePaneRuntimeMocks
export const workspacePaneTabsCommitMocks = hoistedWorkspacePaneTabsCommitMocks

export let projection: TerminalSessionProjection
export let selectedChanges: Array<{ terminalFilesystemTargetKey: string; terminalSessionId: string | null }>

beforeEach(() => {
  resetWorkspacesStore()
  workspacePaneRuntimeMocks.close.mockReset()
  workspacePaneRuntimeMocks.close.mockResolvedValue(successfulRuntimeCloseSnapshot())
  workspacePaneTabsCommitMocks.writeCanonicalSnapshot.mockClear()
  selectedChanges = []
  projection = new TerminalSessionProjection((terminalFilesystemTargetKey, terminalSessionId) =>
    selectedChanges.push({ terminalFilesystemTargetKey, terminalSessionId }),
  )
  // Install into the singleton session so any code that reaches the
  // projection via `getTerminalSessionProjection()` (e.g., a Provider
  // mounted inside a sub-component) sees the same instance this
  // test constructed.
  setTerminalSessionProjectionForTests(projection)
})

afterEach(() => {
  // Drain pending state and clear listener maps on the per-test
  // instance, then release the singleton session so the next test
  // starts clean. Mirrors the production singleton-vs-test
  // contract documented at `setTerminalSessionProjectionForTests`.
  projection.destroy()
  setTerminalSessionProjectionForTests(null)
  resetWorkspacesStore()
})
