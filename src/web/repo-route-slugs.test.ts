import { describe, expect, test } from 'vitest'
import { repoIdFromSlug, repoSlugFromId } from '#/web/repo-route-slugs.ts'

describe('repo route slugs', () => {
  test('encodes local repo paths as base64url slugs', () => {
    const repoId = '/path/to/repo'

    expect(repoSlugFromId(repoId)).toBe('L3BhdGgvdG8vcmVwbw')
    expect(repoIdFromSlug(repoSlugFromId(repoId))).toBe(repoId)
  })

  test('uses the same slug mechanism for remote repo ids', () => {
    const repoId = 'ssh://git.example.test/acme/repo.git'

    expect(repoIdFromSlug(repoSlugFromId(repoId))).toBe(repoId)
  })
})
