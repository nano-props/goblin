import { describe, expect, test } from 'vitest'
import { persistedActiveRepoIdForSession } from '#/web/session-persistence-state.ts'

describe('persistedActiveRepoIdForSession', () => {
  test('persists the store active id directly', () => {
    expect(persistedActiveRepoIdForSession('/tmp/repo-a')).toBe('/tmp/repo-a')
  })

  test('returns null when there is no active repo', () => {
    expect(persistedActiveRepoIdForSession(null)).toBeNull()
  })
})
