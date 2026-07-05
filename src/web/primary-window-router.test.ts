import { describe, expect, test } from 'vitest'
import { initialRepoRouteSlugFromStore } from '#/web/primary-window-router.tsx'
import { repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

describe('primary window initial route', () => {
  test('prefers the restored repo over the first repo in order', () => {
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-instance-a')
    const repoB = emptyRepo('/repo-b', 'repo-b', 'repo-instance-b')

    expect(
      initialRepoRouteSlugFromStore({
        restoredRepoId: '/repo-b',
        order: ['/repo-a', '/repo-b'],
        repos: { '/repo-a': repoA, '/repo-b': repoB },
        sessionReady: true,
      }),
    ).toBe(repoSlugFromId('/repo-b'))
  })

  test('waits for session restore instead of routing to the first partial repo', () => {
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-instance-a')

    expect(
      initialRepoRouteSlugFromStore({
        restoredRepoId: null,
        order: ['/repo-a'],
        repos: { '/repo-a': repoA },
        sessionReady: false,
      }),
    ).toBeNull()
  })

  test('falls back to the first ordered repo when restore has settled without a restored repo', () => {
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-instance-a')

    expect(
      initialRepoRouteSlugFromStore({
        restoredRepoId: '/missing',
        order: ['/repo-a'],
        repos: { '/repo-a': repoA },
        sessionReady: true,
      }),
    ).toBe(repoSlugFromId('/repo-a'))
  })
})
