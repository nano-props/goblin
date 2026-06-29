import { describe, expect, test } from 'vitest'
import { emptyLazyRepoTreeState, lazyRepoTreeReducer } from '#/web/filetree-lazy-state.ts'
import type { RepoTreeNode } from '#/shared/api-types.ts'

function node(id: string, parentId: string | null, kind: RepoTreeNode['kind'] = 'file'): RepoTreeNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind, status: 'clean', ...(kind === 'directory' ? { hasChildren: true } : {}) }
}

describe('filetree lazy state', () => {
  test('tracks loading and loaded prefixes around child reads', () => {
    let state = emptyLazyRepoTreeState()
    state = lazyRepoTreeReducer(state, { type: 'childrenLoading', prefix: 'src' })
    expect(state.loadingPrefixes.has('src')).toBe(true)

    state = lazyRepoTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: 'src',
      result: { nodes: [node('src/index.ts', 'src')], truncated: false },
    })
    state = lazyRepoTreeReducer(state, { type: 'childrenSettled', prefix: 'src' })

    expect(state.loadingPrefixes.has('src')).toBe(false)
    expect(state.loadedPrefixes.has('src')).toBe(true)
    expect(state.result.nodes.map((entry) => entry.id)).toEqual(['src/index.ts'])
  })

  test('tracks child read failures by prefix and clears them on retry', () => {
    let state = emptyLazyRepoTreeState()
    state = lazyRepoTreeReducer(state, { type: 'childrenLoading', prefix: 'src' })
    state = lazyRepoTreeReducer(state, { type: 'childrenFailed', prefix: 'src' })
    state = lazyRepoTreeReducer(state, { type: 'childrenSettled', prefix: 'src' })
    expect(state.errorPrefixes.has('src')).toBe(true)
    expect(state.loadingPrefixes.has('src')).toBe(false)

    state = lazyRepoTreeReducer(state, { type: 'childrenLoading', prefix: 'src' })
    expect(state.errorPrefixes.has('src')).toBe(false)
  })

  test('marks loaded prefixes for reload without dropping the current tree', () => {
    let state = emptyLazyRepoTreeState()
    state = lazyRepoTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: '',
      result: { nodes: [node('src', null, 'directory')], truncated: false },
    })
    state = lazyRepoTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: 'src',
      result: { nodes: [node('src/index.ts', 'src')], truncated: false },
    })

    state = lazyRepoTreeReducer(state, { type: 'markForReload' })

    expect(state.loadedPrefixes.size).toBe(0)
    expect(state.reloadEpoch).toBe(1)
    expect(state.result.nodes.map((entry) => entry.id)).toEqual(['src', 'src/index.ts'])
  })

  test('replacing children prunes stale descendants', () => {
    let state = emptyLazyRepoTreeState()
    state = lazyRepoTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: '',
      result: { nodes: [node('src', null, 'directory')], truncated: false },
    })
    state = lazyRepoTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: 'src',
      result: { nodes: [node('src/old.ts', 'src')], truncated: false },
    })
    state = lazyRepoTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: '',
      result: { nodes: [node('docs', null, 'directory')], truncated: false },
    })

    expect(state.result.nodes.map((entry) => entry.id)).toEqual(['docs'])
  })
})
