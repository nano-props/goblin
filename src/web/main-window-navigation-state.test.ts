import { describe, expect, test } from 'vitest'
import { nextRouteRepoIdAfterClose, visibleRepoIdForMainWindow } from '#/web/main-window-navigation-state.ts'

describe('visibleRepoIdForMainWindow', () => {
  test('prefers the routed repo when it exists in the open workspace set', () => {
    expect(visibleRepoIdForMainWindow('/tmp/repo-b', '/tmp/repo-a', { '/tmp/repo-a': {}, '/tmp/repo-b': {} })).toBe(
      '/tmp/repo-b',
    )
  })

  test('falls back to the store active repo when the routed repo is missing or absent', () => {
    expect(visibleRepoIdForMainWindow('/tmp/missing', '/tmp/repo-a', { '/tmp/repo-a': {} })).toBe('/tmp/repo-a')
    expect(visibleRepoIdForMainWindow(null, '/tmp/repo-a', { '/tmp/repo-a': {} })).toBe('/tmp/repo-a')
  })
})

describe('nextRouteRepoIdAfterClose', () => {
  test('returns undefined when closing an inactive repo', () => {
    expect(nextRouteRepoIdAfterClose(['/tmp/repo-a', '/tmp/repo-b'], '/tmp/repo-a', '/tmp/repo-b')).toBeUndefined()
  })

  test('prefers the right neighbor when closing the active repo', () => {
    expect(nextRouteRepoIdAfterClose(['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'], '/tmp/repo-b', '/tmp/repo-b')).toBe(
      '/tmp/repo-c',
    )
  })

  test('falls back to the left neighbor and then null', () => {
    expect(nextRouteRepoIdAfterClose(['/tmp/repo-a', '/tmp/repo-b'], '/tmp/repo-b', '/tmp/repo-b')).toBe('/tmp/repo-a')
    expect(nextRouteRepoIdAfterClose(['/tmp/repo-a'], '/tmp/repo-a', '/tmp/repo-a')).toBeNull()
  })
})
