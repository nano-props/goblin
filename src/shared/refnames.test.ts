import { describe, expect, test } from 'vitest'
import { isSafeBranchName, isValidBranchInput, MAX_BRANCH_INPUT_LENGTH } from '#/shared/refnames.ts'

describe('isSafeBranchName', () => {
  test('accepts ordinary branch names', () => {
    expect(isSafeBranchName('feature/worktree-actions')).toBe(true)
    expect(isSafeBranchName('user_fix-123')).toBe(true)
    expect(isSafeBranchName('foo#bar')).toBe(true)
    expect(isSafeBranchName('中文/分支')).toBe(true)
  })

  test('rejects option-like and refspec-unsafe names', () => {
    for (const branch of [
      '-f',
      'HEAD',
      'has space',
      'bad\0name',
      'bad..name',
      'bad~name',
      'bad^name',
      'bad:name',
      'bad\\name',
      'bad?name',
      'bad*name',
      'bad[name',
      '.bad',
      'bad/.dot',
      'bad.lock',
      'foo.lock/bar',
      'bad.',
      'bad/',
      '/bad',
      'bad//name',
      'bad@{name',
      '@{-1}',
    ]) {
      expect(isSafeBranchName(branch)).toBe(false)
    }
  })
})

describe('isValidBranchInput', () => {
  test('enforces the branch input length limit', () => {
    expect(isValidBranchInput('feature/add-tests')).toBe(true)
    expect(isValidBranchInput('a'.repeat(MAX_BRANCH_INPUT_LENGTH + 1))).toBe(false)
  })
})
