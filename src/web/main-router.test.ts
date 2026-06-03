import { describe, expect, test } from 'vitest'
import { patchMainWindowSearch } from '#/web/main-router-search.ts'

describe('patchMainWindowSearch', () => {
  test('clears branch and detailTab when repo changes without explicit replacements', () => {
    expect(
      patchMainWindowSearch(
        {
          repo: '/tmp/repo-a',
          branch: 'feature/a',
          detailTab: 'status',
          overlay: 'clone',
        },
        { repoId: '/tmp/repo-b' },
      ),
    ).toEqual({
      repo: '/tmp/repo-b',
      overlay: 'clone',
    })
  })

  test('preserves explicitly provided branch and detailTab when repo changes', () => {
    expect(
      patchMainWindowSearch(
        {
          repo: '/tmp/repo-a',
          branch: 'feature/a',
          detailTab: 'status',
        },
        {
          repoId: '/tmp/repo-b',
          branch: 'feature/b',
          detailTab: 'terminal',
        },
      ),
    ).toEqual({
      repo: '/tmp/repo-b',
      branch: 'feature/b',
      detailTab: 'terminal',
    })
  })

  test('clears dependent params when repo is removed', () => {
    expect(
      patchMainWindowSearch(
        {
          repo: '/tmp/repo-a',
          branch: 'feature/a',
          detailTab: 'status',
          overlay: 'openRepo',
        },
        { repoId: null },
      ),
    ).toEqual({
      overlay: 'openRepo',
    })
  })
})
