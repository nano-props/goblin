/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { tildifyPath, untildifyPath } from '#/renderer/lib/paths.ts'

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
