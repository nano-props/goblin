import { describe, expect, test } from 'bun:test'
import { markDefaultBranch, prioritizeDefaultBranch } from '#/main/git/branches.ts'
import type { BranchInfo } from '#/main/git/types.ts'

function branch(name: string): BranchInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
  }
}

describe('prioritizeDefaultBranch', () => {
  test('moves the default branch to the top', () => {
    const result = prioritizeDefaultBranch([branch('feature/a'), branch('main'), branch('release')], 'main')
    expect(result.map((b) => b.name)).toEqual(['main', 'feature/a', 'release'])
  })

  test('preserves order when the default branch is absent', () => {
    const result = prioritizeDefaultBranch([branch('feature/a'), branch('release')], 'main')
    expect(result.map((b) => b.name)).toEqual(['feature/a', 'release'])
  })

  test('preserves order when no default branch is known', () => {
    const result = prioritizeDefaultBranch([branch('feature/a'), branch('main')], '')
    expect(result.map((b) => b.name)).toEqual(['feature/a', 'main'])
  })
})

describe('markDefaultBranch', () => {
  test('marks only the default branch', () => {
    const result = markDefaultBranch([branch('feature/a'), branch('main')], 'main')
    expect(result.find((b) => b.name === 'feature/a')?.isDefault).toBeUndefined()
    expect(result.find((b) => b.name === 'main')?.isDefault).toBe(true)
  })

  test('clears stale default markers', () => {
    const result = markDefaultBranch([{ ...branch('feature/a'), isDefault: true }, branch('main')], 'main')
    expect(result.find((b) => b.name === 'feature/a')?.isDefault).toBeUndefined()
    expect(result.find((b) => b.name === 'main')?.isDefault).toBe(true)
  })

  test('preserves branches when no default branch is known', () => {
    const branches = [branch('feature/a'), branch('main')]
    expect(markDefaultBranch(branches, '')).toBe(branches)
  })

  test('clears stale default markers when no default branch is known', () => {
    const [result] = markDefaultBranch([{ ...branch('feature/a'), isDefault: true }], '')
    expect(result?.isDefault).toBeUndefined()
  })
})
