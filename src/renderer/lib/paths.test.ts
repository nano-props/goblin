/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { defaultWorktreePath, joinPath, parentDir, tildifyPath, untildifyPath } from '#/renderer/lib/paths.ts'

describe('tildifyPath', () => {
  test('shortens paths inside home', () => {
    expect(tildifyPath('/Users/alice/Developer/repo', '/Users/alice')).toBe('~/Developer/repo')
  })

  test('shortens home itself', () => {
    expect(tildifyPath('/Users/alice', '/Users/alice')).toBe('~')
  })

  test('does not shorten sibling prefixes', () => {
    expect(tildifyPath('/Users/alice-work/repo', '/Users/alice')).toBe('/Users/alice-work/repo')
  })
})

describe('untildifyPath', () => {
  test('expands tilde paths', () => {
    expect(untildifyPath('~/Developer/repo', '/Users/alice')).toBe('/Users/alice/Developer/repo')
  })

  test('expands tilde home', () => {
    expect(untildifyPath('~', '/Users/alice')).toBe('/Users/alice')
  })

  test('does not expand named-user tildes', () => {
    expect(untildifyPath('~bob/repo', '/Users/alice')).toBe('~bob/repo')
  })
})

describe('parentDir', () => {
  test('returns root for the POSIX root path', () => {
    expect(parentDir('/')).toBe('/')
  })

  test('returns root for paths directly under root', () => {
    expect(parentDir('/repo')).toBe('/')
  })

  test('returns parent for nested paths', () => {
    expect(parentDir('/Users/alice/repo')).toBe('/Users/alice')
  })

  test('returns drive root for Windows paths directly under a drive', () => {
    expect(parentDir('C:\\repo')).toBe('C:\\')
  })

  test('returns drive root for Windows drive roots', () => {
    expect(parentDir('C:\\')).toBe('C:\\')
  })
})

describe('joinPath', () => {
  test('does not double the POSIX root separator', () => {
    expect(joinPath('/', 'repo-feature')).toBe('/repo-feature')
  })

  test('uses Windows separators for Windows parents', () => {
    expect(joinPath('C:\\Users\\alice', 'repo-feature')).toBe('C:\\Users\\alice\\repo-feature')
  })

  test('keeps Windows drive roots absolute', () => {
    expect(joinPath('C:\\', 'repo-feature')).toBe('C:\\repo-feature')
  })
})

describe('defaultWorktreePath', () => {
  test('derives sibling paths for normal POSIX repos', () => {
    expect(defaultWorktreePath('/repo', 'feature/x')).toBe('/repo-feature-x')
  })

  test('keeps POSIX root repo defaults absolute', () => {
    expect(defaultWorktreePath('/', 'feature/x')).toBe('/worktree-feature-x')
  })

  test('keeps Windows drive root repo defaults absolute', () => {
    expect(defaultWorktreePath('C:\\', 'feature/x')).toBe('C:\\worktree-feature-x')
  })
})
