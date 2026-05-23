import { describe, expect, test } from 'vitest'
import { normalizeRepoCache } from '#/renderer/stores/repos/persistence.ts'
import type { CachedRepoState } from '#/renderer/stores/repos/types.ts'

function cachedRepo(savedAt: number): CachedRepoState {
  return {
    savedAt,
    name: 'repo',
    data: {
      branches: [],
      currentBranch: '',
      status: [],
      statusLoaded: false,
    },
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      detailTab: 'status',
    },
  }
}

describe('normalizeRepoCache', () => {
  test('keeps only the newest 50 valid cache entries', () => {
    const now = Date.now()
    const raw = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [`/repo-${index}`, cachedRepo(now + index)]),
    )

    const normalized = normalizeRepoCache(raw)

    expect(Object.keys(normalized)).toHaveLength(50)
    expect(normalized['/repo-0']).toBeUndefined()
    expect(normalized['/repo-4']).toBeUndefined()
    expect(normalized['/repo-5']).toBeDefined()
    expect(Object.keys(normalized)[0]).toBe('/repo-54')
  })

  test('drops expired and invalid cache entries', () => {
    const now = Date.now()
    const normalized = normalizeRepoCache({
      fresh: cachedRepo(now),
      expired: cachedRepo(now - 15 * 24 * 60 * 60 * 1000),
      invalid: { savedAt: now, name: 'repo' },
    })

    expect(Object.keys(normalized)).toEqual(['fresh'])
  })
})
