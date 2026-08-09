import { describe, expect, test } from 'vitest'
import { tildifyPath, untildifyPath } from '#/shared/paths.ts'
import { defaultWorktreePath, joinPath, parentDir } from '#/web/lib/paths.ts'

describe('tildifyPath', () => {
  test('shortens paths inside home', async () => {
    expect(tildifyPath('/Users/alice/Developer/repo', '/Users/alice')).toBe('~/Developer/repo')
  })

  test('shortens home itself', async () => {
    expect(tildifyPath('/Users/alice', '/Users/alice')).toBe('~')
  })

  test('does not shorten sibling prefixes', async () => {
    expect(tildifyPath('/Users/alice-work/repo', '/Users/alice')).toBe('/Users/alice-work/repo')
  })
})

describe('untildifyPath', () => {
  test('expands tilde paths', async () => {
    expect(untildifyPath('~/Developer/repo', '/Users/alice')).toBe('/Users/alice/Developer/repo')
  })

  test('expands tilde home', async () => {
    expect(untildifyPath('~', '/Users/alice')).toBe('/Users/alice')
  })

  test('does not expand named-user tildes', async () => {
    expect(untildifyPath('~bob/repo', '/Users/alice')).toBe('~bob/repo')
  })
})

describe('parentDir', () => {
  test('returns root for the POSIX root path', async () => {
    expect(parentDir('/')).toBe('/')
  })

  test('returns root for paths directly under root', async () => {
    expect(parentDir('/repo')).toBe('/')
  })

  test('returns parent for nested paths', async () => {
    expect(parentDir('/Users/alice/repo')).toBe('/Users/alice')
  })

  test('returns drive root for Windows paths directly under a drive', async () => {
    expect(parentDir('C:\\repo')).toBe('C:\\')
  })

  test('returns drive root for Windows drive roots', async () => {
    expect(parentDir('C:\\')).toBe('C:\\')
  })
})

describe('joinPath', () => {
  test('does not double the POSIX root separator', async () => {
    expect(joinPath('/', 'repo-feature')).toBe('/repo-feature')
  })

  test('uses Windows separators for Windows parents', async () => {
    expect(joinPath('C:\\Users\\alice', 'repo-feature')).toBe('C:\\Users\\alice\\repo-feature')
  })

  test('keeps Windows drive roots absolute', async () => {
    expect(joinPath('C:\\', 'repo-feature')).toBe('C:\\repo-feature')
  })
})

describe('defaultWorktreePath', () => {
  test('derives sibling paths for normal POSIX repos', async () => {
    expect(defaultWorktreePath('/repo', 'feature/x')).toBe('/repo-feature-x')
  })

  test('keeps POSIX root repo defaults absolute', async () => {
    expect(defaultWorktreePath('/', 'feature/x')).toBe('/worktree-feature-x')
  })

  test('keeps Windows drive root repo defaults absolute', async () => {
    expect(defaultWorktreePath('C:\\', 'feature/x')).toBe('C:\\worktree-feature-x')
  })
})
