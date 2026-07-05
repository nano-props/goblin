import { describe, expect, test } from 'vitest'
import { persistedRestoredRepoIdForSession } from '#/web/session-persistence-state.ts'

describe('persistedRestoredRepoIdForSession', () => {
  test('persists the store active id directly', () => {
    expect(persistedRestoredRepoIdForSession('/tmp/repo-a')).toBe('/tmp/repo-a')
  })

  test('returns null when there is no restored repo', () => {
    expect(persistedRestoredRepoIdForSession(null)).toBeNull()
  })
})
