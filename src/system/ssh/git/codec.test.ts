import { describe, expect, test } from 'vitest'
import { parseRemoteRepoCommonDir } from '#/system/ssh/git/codec.ts'

describe('remote Git codec', () => {
  test('parses a canonical repository common directory', () => {
    expect(parseRemoteRepoCommonDir('/srv/repo/.git\0')).toBe('/srv/repo/.git')
  })

  test('rejects malformed repository common directory output', () => {
    expect(parseRemoteRepoCommonDir('')).toBeNull()
  })
})
