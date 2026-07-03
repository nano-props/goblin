import { describe, expect, test } from 'vitest'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { createRepoBranch } from '#/web/test-utils/bridge.ts'
import {
  branchForTerminalWorktree,
  repoIndexFromEntries,
  type TerminalRepoIndexEntry,
} from '#/web/components/terminal/terminal-repo-index.ts'

const REPO_ID = '/tmp/terminal-repo-index-repo'
const WORKTREE_PATH = '/tmp/terminal-repo-index-worktree'

describe('terminal repo index', () => {
  test('builds worktree branch mappings from snapshot read models when store branches are stale', () => {
    const repo = emptyRepo(REPO_ID, 'terminal-repo-index-repo', 'repo-instance-terminal-index')
    repo.data.branches = []
    const entries: TerminalRepoIndexEntry[] = [
      {
        id: repo.id,
        instanceId: repo.instanceId,
        data: repo.data,
      },
    ]

    const index = repoIndexFromEntries(entries, [
      {
        current: 'feature/terminal',
        branches: [createRepoBranch('feature/terminal', { worktree: { path: WORKTREE_PATH } })],
      },
    ])

    expect(branchForTerminalWorktree(index, REPO_ID, WORKTREE_PATH)).toBe('feature/terminal')
  })
})
