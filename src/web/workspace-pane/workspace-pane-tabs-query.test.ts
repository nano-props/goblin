import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import type { WorkspacePaneTabsEntry } from '#/shared/terminal-types.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import {
  readWorkspacePaneTabsForBranch,
  setWorkspacePaneTabsForBranchQueryData,
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-query-repo'

describe('workspace pane tabs query cache', () => {
  test('keeps no-worktree branch cache entries static-only', () => {
    const queryClient = new QueryClient()

    setWorkspacePaneTabsForBranchQueryData(
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneTerminalTabEntry('session-stale'),
          workspacePaneStaticTabEntry('files'),
        ],
      },
      queryClient,
    )

    expect(readWorkspacePaneTabsForBranch(REPO_ROOT, 'feature/no-worktree', queryClient)).toEqual([
      workspacePaneStaticTabEntry('status'),
    ])
    expect(queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT))).toEqual([
      entry('feature/no-worktree', null, [workspacePaneStaticTabEntry('status')]),
    ])
  })

  test('dedupes polluted branch cache entries on write', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT), [
      entry('feature/duplicate', '/tmp/worktree', [workspacePaneStaticTabEntry('status')]),
      entry('feature/duplicate', '/tmp/worktree', [workspacePaneStaticTabEntry('history')]),
    ])

    setWorkspacePaneTabsForBranchQueryData(
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/new',
        worktreePath: null,
        tabs: [workspacePaneStaticTabEntry('status')],
      },
      queryClient,
    )

    expect(queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT))).toEqual([
      entry('feature/duplicate', '/tmp/worktree', [workspacePaneStaticTabEntry('history')]),
      entry('feature/new', null, [workspacePaneStaticTabEntry('status')]),
    ])
  })
})

function entry(
  branchName: string,
  worktreePath: string | null,
  tabs: WorkspacePaneTabsEntry['tabs'],
): WorkspacePaneTabsEntry {
  return { repoRoot: REPO_ROOT, branchName, worktreePath, tabs }
}
