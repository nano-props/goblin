import { describe, expect, test } from 'vitest'
import { branchPullRequestBelongsToBranch, type BranchSnapshotInfo, type PullRequestInfo } from '#/shared/git-types.ts'

function branch(name: string, options: Partial<BranchSnapshotInfo> = {}): Pick<BranchSnapshotInfo, 'name' | 'isDefault'> {
  return { name, ...options }
}

function pr(options: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 1,
    title: 'PR 1',
    url: 'https://github.com/acme/repo/pull/1',
    state: 'open',
    ...options,
  }
}

describe('branchPullRequestBelongsToBranch', () => {
  test('accepts pull requests whose head branch matches a regular branch', () => {
    expect(
      branchPullRequestBelongsToBranch(branch('feature/a'), pr({ headRefName: 'feature/a', baseRefName: 'main' })),
    ).toBe(true)
  })

  test('rejects pull requests whose explicit head branch does not match', () => {
    expect(
      branchPullRequestBelongsToBranch(branch('feature/a'), pr({ headRefName: 'feature/b', baseRefName: 'main' })),
    ).toBe(false)
  })

  test('accepts pull requests without a head branch on regular branches', () => {
    expect(branchPullRequestBelongsToBranch(branch('feature/a'), pr({ baseRefName: 'main' }))).toBe(true)
  })

  test('rejects default-branch pull requests without a head branch', () => {
    expect(branchPullRequestBelongsToBranch(branch('main', { isDefault: true }), pr({ baseRefName: 'main' }))).toBe(
      false,
    )
  })

  test('rejects default-branch reverse pull requests', () => {
    expect(
      branchPullRequestBelongsToBranch(
        branch('master', { isDefault: true }),
        pr({ headRefName: 'master', baseRefName: 'feature/a' }),
      ),
    ).toBe(false)
  })

  test('rejects default-branch pull requests without a matching base branch', () => {
    expect(branchPullRequestBelongsToBranch(branch('master', { isDefault: true }), pr({ headRefName: 'master' }))).toBe(
      false,
    )
  })
})
