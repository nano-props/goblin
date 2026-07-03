import { describe, expect, test } from 'vitest'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { createRepoBranch } from '#/web/test-utils/bridge.ts'
import {
  repoBranchesFromReadModel,
  repoWithBranchReadModel,
  type RepoBranchReadModelData,
} from '#/web/repo-branch-read-model.ts'

describe('repo branch read model helpers', () => {
  test('projects branch snapshot data over store repo data as one atomic view', () => {
    const repo = emptyRepo('/tmp/read-model-repo', 'read-model-repo', 'repo-instance-read-model')
    repo.data.currentBranch = 'main'
    repo.data.branches = [createRepoBranch('main')]
    repo.data.worktreesByPath = {}
    const readModel: RepoBranchReadModelData = {
      currentBranch: 'feature/query',
      currentHEAD: '1111111000000000000000000000000000000000',
      branches: [createRepoBranch('feature/query', { worktree: { path: '/tmp/query-worktree' } })],
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
    }

    const projected = repoWithBranchReadModel(repo, readModel)

    expect(projected).not.toBe(repo)
    expect(projected.data.currentBranch).toBe('feature/query')
    expect(projected.data.currentHEAD).toBe('1111111000000000000000000000000000000000')
    expect(projected.data.branches.map((branch) => branch.name)).toEqual(['feature/query'])
    expect(projected.data.worktreesByPath['/tmp/query-worktree']?.branch).toBe('feature/query')
  })

  test('falls back to store branches only when no branch read model is available', () => {
    const repo = emptyRepo('/tmp/read-model-fallback-repo', 'read-model-fallback-repo', 'repo-instance-fallback')
    repo.data.branches = [createRepoBranch('main')]

    expect(repoBranchesFromReadModel(repo, null).map((branch) => branch.name)).toEqual(['main'])
    const queryBranches = repoBranchesFromReadModel(repo, {
      branches: [createRepoBranch('feature/query')],
    })
    expect(queryBranches.map((branch) => branch.name)).toEqual(['feature/query'])
  })
})
