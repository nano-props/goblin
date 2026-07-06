// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  projectWorkspaceRuntimeTabsForWorktree,
  workspaceTabsWithoutStaleRuntimeEntries,
} from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'

const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'

describe('workspace pane runtime tabs projection', () => {
  test('prunes stale runtime tabs and materializes missing live runtime tabs', () => {
    expect(
      projectWorkspaceRuntimeTabsForWorktree({
        runtimeType: 'terminal',
        worktreePath: WORKTREE_PATH,
        entries: [
          {
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            tabs: [
              workspacePaneStaticTabEntry('status'),
              workspacePaneRuntimeTabEntry('terminal', 'session-stale'),
              workspacePaneStaticTabEntry('history'),
              workspacePaneRuntimeTabEntry('terminal', 'session-live'),
            ],
          },
        ],
        liveSessions: [
          { sessionId: 'session-live', branch: BRANCH_NAME },
          { sessionId: 'session-missing', branch: BRANCH_NAME },
        ],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
          workspacePaneRuntimeTabEntry('terminal', 'session-live'),
          workspacePaneRuntimeTabEntry('terminal', 'session-missing'),
        ],
      },
    ])
  })

  test('uses the existing worktree entry branch when materializing sessions', () => {
    expect(
      projectWorkspaceRuntimeTabsForWorktree({
        runtimeType: 'terminal',
        worktreePath: WORKTREE_PATH,
        entries: [
          {
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            tabs: [workspacePaneStaticTabEntry('status')],
          },
        ],
        liveSessions: [{ sessionId: 'session-live', branch: 'feature/from-session' }],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-live')],
      },
    ])
  })

  test('uses live runtime sessions to materialize a discovered worktree', () => {
    expect(
      projectWorkspaceRuntimeTabsForWorktree({
        runtimeType: 'terminal',
        worktreePath: WORKTREE_PATH,
        entries: [],
        liveSessions: [{ sessionId: 'session-live', branch: BRANCH_NAME }],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-live')],
      },
    ])
  })

  test('does not materialize runtime tabs when no live sessions exist', () => {
    expect(
      projectWorkspaceRuntimeTabsForWorktree({
        runtimeType: 'terminal',
        worktreePath: WORKTREE_PATH,
        entries: [
          {
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-stale')],
          },
        ],
        liveSessions: [],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ])
  })

  test('deduplicates repeated tab entries while pruning stale runtime entries', () => {
    expect(
      workspaceTabsWithoutStaleRuntimeEntries(
        [
          workspacePaneRuntimeTabEntry('terminal', 'session-live'),
          workspacePaneRuntimeTabEntry('terminal', 'session-live'),
          workspacePaneRuntimeTabEntry('terminal', 'session-stale'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('status'),
        ],
        'terminal',
        ['session-live'],
      ),
    ).toEqual([workspacePaneRuntimeTabEntry('terminal', 'session-live'), workspacePaneStaticTabEntry('status')])
  })
})
