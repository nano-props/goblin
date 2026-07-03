import { describe, expect, test } from 'vitest'
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'

describe('repo branch read model helpers', () => {
  test('builds the branch read model from snapshot plus explicit current projections', () => {
    const snapshot: RepoSnapshot = {
      current: 'feature/query',
      currentHEAD: '1111111000000000000000000000000000000000',
      branches: [
        {
          name: 'feature/query',
          isCurrent: true,
          ahead: 0,
          behind: 0,
          lastCommitHash: '1111111000000000000000000000000000000000',
          lastCommitShortHash: '1111111',
          lastCommitMessage: 'Test commit',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
          lastCommitAuthor: 'Test Author',
          worktree: {
            path: '/tmp/query-worktree',
            isPrimary: false,
            isLocked: true,
            summary: {
              dirty: false,
              changeCount: 0,
            },
          },
          pullRequest: {
            number: 123,
            title: 'Draft',
            url: 'https://example.invalid/pr/123',
            state: 'open',
          },
        },
      ],
    }

    const readModel = repoBranchReadModelFromSnapshot(snapshot, {
      worktreesByPath: {
        '/tmp/query-worktree': {
          path: '/tmp/query-worktree',
          branch: 'feature/query',
          isMain: false,
          isDirty: false,
          changeCount: 0,
          isLocked: false,
        },
      },
      status: [
        {
          path: '/tmp/query-worktree',
          branch: 'feature/query',
          isMain: false,
          entries: [{ path: 'changed.txt', x: 'M', y: 'M' }],
        },
      ],
    })

    expect(readModel.currentBranch).toBe('feature/query')
    expect(readModel.currentHEAD).toBe('1111111000000000000000000000000000000000')
    expect(readModel.status[0]?.entries).toHaveLength(1)
    expect(readModel.branches).toEqual([
      expect.objectContaining({
        name: 'feature/query',
        worktree: { path: '/tmp/query-worktree' },
      }),
    ])
    expect(readModel.branches[0]).not.toHaveProperty('pullRequest')
    expect(readModel.worktreesByPath['/tmp/query-worktree']).toEqual({
      path: '/tmp/query-worktree',
      branch: 'feature/query',
      isMain: false,
      isDirty: true,
      changeCount: 1,
      isLocked: true,
    })
  })
})
