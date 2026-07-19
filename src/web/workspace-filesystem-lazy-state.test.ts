import { describe, expect, test } from 'vitest'
import {
  emptyLazyWorkspaceFilesystemTreeState,
  lazyWorkspaceFilesystemTreeReducer,
} from '#/web/workspace-filesystem-lazy-state.ts'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'

function node(
  id: string,
  parentId: string | null,
  kind: WorkspaceFilesystemNode['kind'] = 'file',
): WorkspaceFilesystemNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind, status: 'clean', ...(kind === 'directory' ? { hasChildren: true } : {}) }
}

describe('filetree lazy state', () => {
  test('tracks loading and loaded prefixes around child reads', () => {
    let state = emptyLazyWorkspaceFilesystemTreeState()
    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenLoading', prefix: 'src' })
    expect(state.loadingPrefixes.has('src')).toBe(true)

    state = lazyWorkspaceFilesystemTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: 'src',
      result: { nodes: [node('src/index.ts', 'src')], truncated: false },
    })
    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenSettled', prefix: 'src' })

    expect(state.loadingPrefixes.has('src')).toBe(false)
    expect(state.loadedPrefixes.has('src')).toBe(true)
    expect(state.result.nodes.map((entry) => entry.id)).toEqual(['src/index.ts'])
  })

  test('tracks child read failures by prefix and clears them on retry', () => {
    let state = emptyLazyWorkspaceFilesystemTreeState()
    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenLoading', prefix: 'src' })
    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenFailed', prefix: 'src' })
    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenSettled', prefix: 'src' })
    expect(state.errorPrefixes.has('src')).toBe(true)
    expect(state.loadingPrefixes.has('src')).toBe(false)

    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenLoading', prefix: 'src' })
    expect(state.errorPrefixes.has('src')).toBe(false)
  })

  test('marks loaded prefixes for reload without dropping the current tree', () => {
    let state = emptyLazyWorkspaceFilesystemTreeState()
    state = lazyWorkspaceFilesystemTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: '',
      result: { nodes: [node('src', null, 'directory')], truncated: false },
    })
    state = lazyWorkspaceFilesystemTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: 'src',
      result: { nodes: [node('src/index.ts', 'src')], truncated: false },
    })

    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'markForReload' })

    expect(state.loadedPrefixes.size).toBe(0)
    expect(state.reloadEpoch).toBe(1)
    expect(state.result.nodes.map((entry) => entry.id)).toEqual(['src', 'src/index.ts'])
  })

  test('replacing children prunes stale descendants', () => {
    let state = emptyLazyWorkspaceFilesystemTreeState()
    state = lazyWorkspaceFilesystemTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: '',
      result: { nodes: [node('src', null, 'directory')], truncated: false },
    })
    state = lazyWorkspaceFilesystemTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: 'src',
      result: { nodes: [node('src/old.ts', 'src')], truncated: false },
    })
    state = lazyWorkspaceFilesystemTreeReducer(state, {
      type: 'childrenLoaded',
      prefix: '',
      result: { nodes: [node('docs', null, 'directory')], truncated: false },
    })

    expect(state.result.nodes.map((entry) => entry.id)).toEqual(['docs'])
  })
})
