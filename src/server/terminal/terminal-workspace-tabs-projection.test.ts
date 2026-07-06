// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  projectWorkspaceTerminalTabsForWorktree,
  workspaceTabsWithoutStaleTerminalEntries,
} from '#/server/terminal/terminal-workspace-tabs-projection.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'

const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'

describe('terminal workspace tabs projection', () => {
  test('prunes stale terminal tabs and materializes missing live terminal tabs', () => {
    expect(
      projectWorkspaceTerminalTabsForWorktree({
        worktreePath: WORKTREE_PATH,
        entries: [
          {
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            tabs: [
              workspacePaneStaticTabEntry('status'),
              workspacePaneTerminalTabEntry('session-stale'),
              workspacePaneStaticTabEntry('history'),
              workspacePaneTerminalTabEntry('session-live'),
            ],
          },
        ],
        liveSessions: [
          { terminalSessionId: 'session-live', branch: BRANCH_NAME },
          { terminalSessionId: 'session-missing', branch: BRANCH_NAME },
        ],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
          workspacePaneTerminalTabEntry('session-live'),
          workspacePaneTerminalTabEntry('session-missing'),
        ],
      },
    ])
  })

  test('uses the existing worktree entry branch when materializing sessions', () => {
    expect(
      projectWorkspaceTerminalTabsForWorktree({
        worktreePath: WORKTREE_PATH,
        entries: [
          {
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            tabs: [workspacePaneStaticTabEntry('status')],
          },
        ],
        liveSessions: [{ terminalSessionId: 'session-live', branch: 'feature/from-session' }],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])
  })

  test('materializes the default status tab for a discovered live worktree', () => {
    expect(
      projectWorkspaceTerminalTabsForWorktree({
        worktreePath: WORKTREE_PATH,
        entries: [],
        liveSessions: [{ terminalSessionId: 'session-live', branch: BRANCH_NAME }],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])
  })

  test('does not materialize terminal tabs when no live sessions exist', () => {
    expect(
      projectWorkspaceTerminalTabsForWorktree({
        worktreePath: WORKTREE_PATH,
        entries: [
          {
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-stale')],
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

  test('deduplicates repeated tab entries while pruning stale terminals', () => {
    expect(
      workspaceTabsWithoutStaleTerminalEntries(
        [
          workspacePaneTerminalTabEntry('session-live'),
          workspacePaneTerminalTabEntry('session-live'),
          workspacePaneTerminalTabEntry('session-stale'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('status'),
        ],
        ['session-live'],
      ),
    ).toEqual([workspacePaneTerminalTabEntry('session-live'), workspacePaneStaticTabEntry('status')])
  })
})
