import { describe, expect, test } from 'vitest'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceTerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { orderWorkspaceDashboardTerminals } from '#/web/components/workspace-pages/workspace-dashboard-terminal-order.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const RUNTIME_ID = 'workspace-runtime-order'
const FIRST_WORKTREE_PATH = '/workspace/first'
const SECOND_WORKTREE_PATH = '/workspace/second'
const FIRST_WORKTREE_ID = workspaceIdForTest(`goblin+file://${FIRST_WORKTREE_PATH}`)
const SECOND_WORKTREE_ID = workspaceIdForTest(`goblin+file://${SECOND_WORKTREE_PATH}`)

describe('workspace dashboard terminal order', () => {
  test('orders worktrees by repository branch order and terminals by canonical tab order', () => {
    const sessions = [
      session('second-a', SECOND_WORKTREE_ID, 'branch/second'),
      session('first-b', FIRST_WORKTREE_ID, 'branch/first'),
      rootSession('root-b'),
      session('first-a', FIRST_WORKTREE_ID, 'branch/first'),
      rootSession('root-a'),
    ]
    const paneTabs: WorkspacePaneTabsSnapshot = {
      revision: 4,
      entries: [
        {
          target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: RUNTIME_ID },
          tabs: [
            { type: 'terminal', runtimeSessionId: 'root-a' },
            { type: 'terminal', runtimeSessionId: 'root-b' },
          ],
        },
        {
          target: {
            kind: 'git-worktree',
            workspaceId: WORKSPACE_ID,
            workspaceRuntimeId: RUNTIME_ID,
            root: FIRST_WORKTREE_ID,
          },
          tabs: [
            { type: 'terminal', runtimeSessionId: 'first-a' },
            { type: 'terminal', runtimeSessionId: 'first-b' },
          ],
        },
      ],
    }

    expect(
      orderWorkspaceDashboardTerminals({
        workspaceId: WORKSPACE_ID,
        sessions,
        branches: [branch('branch/first', FIRST_WORKTREE_PATH), branch('branch/second', SECOND_WORKTREE_PATH)],
        paneTabs,
      }).map(({ terminalSessionId }) => terminalSessionId),
    ).toEqual(['root-a', 'root-b', 'first-a', 'first-b', 'second-a'])
  })

  test('keeps established terminals in stable fallback order when branch or tab projections are missing', () => {
    const sessions = [
      session('detached-a', FIRST_WORKTREE_ID, null),
      session('detached-b', FIRST_WORKTREE_ID, null),
      session('unknown', SECOND_WORKTREE_ID, 'branch/unknown'),
    ]

    expect(
      orderWorkspaceDashboardTerminals({
        workspaceId: WORKSPACE_ID,
        sessions,
        branches: [],
        paneTabs: undefined,
      }).map(({ terminalSessionId }) => terminalSessionId),
    ).toEqual(['detached-a', 'detached-b', 'unknown'])
  })
})

function branch(name: string, worktreePath: string): BranchSnapshotInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '0123456789abcdef',
    lastCommitShortHash: '0123456',
    lastCommitMessage: 'Test commit',
    lastCommitDate: '2026-01-01T00:00:00.000Z',
    lastCommitAuthor: 'Test User',
    worktree: { path: worktreePath, isPrimary: false, isLocked: false },
  }
}

function rootSession(terminalSessionId: string): WorkspaceTerminalSessionSummary {
  return summary(terminalSessionId, {
    target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: RUNTIME_ID },
    presentation: { kind: 'workspace-root' },
  })
}

function session(
  terminalSessionId: string,
  root: WorkspaceId,
  branchName: string | null,
): WorkspaceTerminalSessionSummary {
  return summary(terminalSessionId, {
    target: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, workspaceRuntimeId: RUNTIME_ID, root },
    presentation: {
      kind: 'git-worktree',
      head: branchName ? { kind: 'branch', branchName } : { kind: 'detached' },
    },
  })
}

function summary(
  terminalSessionId: string,
  base: WorkspaceTerminalSessionSummary['base'],
): WorkspaceTerminalSessionSummary {
  return {
    type: 'terminal',
    terminalFilesystemTargetKey: terminalSessionId,
    terminalSessionId,
    index: 0,
    title: terminalSessionId,
    fullTitle: terminalSessionId,
    processName: 'zsh',
    phase: 'open',
    selected: false,
    hasBell: false,
    hasRecentOutput: false,
    base,
  }
}
