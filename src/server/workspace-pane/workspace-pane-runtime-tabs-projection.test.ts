// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  projectCanonicalWorkspacePaneTabs,
  projectWorkspaceRuntimeTabsForWorktree,
  workspaceTabsWithoutStaleRuntimeEntries,
} from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'

const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'

describe('workspace pane runtime tabs projection', () => {
  test('projects a full scope without mutating layout input', () => {
    const entries = [{
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    }]
    expect(projectCanonicalWorkspacePaneTabs({
      entries,
      providerSnapshots: [{
        type: 'terminal',
        liveSessions: [{ sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH }],
      }],
    })).toEqual([{
      ...entries[0],
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1')],
    }])
    expect(entries[0]!.tabs).toEqual([workspacePaneStaticTabEntry('status')])
  })
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
              workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
              workspacePaneStaticTabEntry('history'),
              workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
            ],
          },
        ],
        liveSessions: [
          { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME },
          { sessionId: 'term-missingmissingmissing', branch: BRANCH_NAME },
        ],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
          workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          workspacePaneRuntimeTabEntry('terminal', 'term-missingmissingmissing'),
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
        liveSessions: [{ sessionId: 'term-livelivelivelivelive1', branch: 'feature/from-session' }],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1')],
      },
    ])
  })

  test('uses live runtime sessions to materialize a discovered worktree', () => {
    expect(
      projectWorkspaceRuntimeTabsForWorktree({
        runtimeType: 'terminal',
        worktreePath: WORKTREE_PATH,
        entries: [],
        liveSessions: [{ sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME }],
      }),
    ).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1')],
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
            tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1')],
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
          workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('status'),
        ],
        'terminal',
        ['term-livelivelivelivelive1'],
      ),
    ).toEqual([workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'), workspacePaneStaticTabEntry('status')])
  })
})
