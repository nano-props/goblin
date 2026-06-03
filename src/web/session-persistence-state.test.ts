import { describe, expect, test } from 'vitest'
import { persistedActiveRepoIdForSession } from '#/web/session-persistence-state.ts'

describe('persistedActiveRepoIdForSession', () => {
  test('prefers a valid route repo id over the store active id', () => {
    expect(
      persistedActiveRepoIdForSession('/tmp/repo-b', '/tmp/repo-a', {
        '/tmp/repo-a': {},
        '/tmp/repo-b': {},
      }),
    ).toBe('/tmp/repo-b')
  })

  test('falls back to the store active id when the route repo is missing', () => {
    expect(
      persistedActiveRepoIdForSession('/tmp/missing', '/tmp/repo-a', {
        '/tmp/repo-a': {},
      }),
    ).toBe('/tmp/repo-a')
  })

  test('returns null when neither route nor store has an active repo', () => {
    expect(persistedActiveRepoIdForSession(null, null, {})).toBeNull()
  })
})
