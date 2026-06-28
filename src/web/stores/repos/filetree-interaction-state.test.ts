import { beforeEach, describe, expect, test } from 'vitest'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'

describe('useFiletreeInteractionStore', () => {
  beforeEach(() => {
    resetFiletreeInteractionStore()
  })

  test('stores selected and expanded keys by repo worktree scope', () => {
    const scopeA = filetreeInteractionScopeKey('repo-a', '/worktree/a')
    const scopeB = filetreeInteractionScopeKey('repo-a', '/worktree/b')

    useFiletreeInteractionStore.getState().setSelectedKeys(scopeA, ['src/index.ts'])
    useFiletreeInteractionStore.getState().setExpandedKeys(scopeA, ['src', 'src/web'])
    useFiletreeInteractionStore.getState().setExpandedKeys(scopeB, ['docs'])

    expect(useFiletreeInteractionStore.getState().interactionByScope[scopeA]).toEqual({
      selectedKeys: ['src/index.ts'],
      expandedKeys: ['src', 'src/web'],
      topVisibleRowIndex: 0,
    })
    expect(useFiletreeInteractionStore.getState().interactionByScope[scopeB]).toEqual({
      selectedKeys: [],
      expandedKeys: ['docs'],
      topVisibleRowIndex: 0,
    })
  })

  test('prunes keys that no longer exist in the loaded tree', () => {
    const scopeKey = filetreeInteractionScopeKey('repo-a', '/worktree/a')
    useFiletreeInteractionStore.getState().setSelectedKeys(scopeKey, ['README.md'])
    useFiletreeInteractionStore.getState().setExpandedKeys(scopeKey, ['src', 'docs'])

    useFiletreeInteractionStore.getState().pruneKeys(scopeKey, new Set(['src', 'src/index.ts']))

    expect(useFiletreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: [],
      expandedKeys: ['src'],
      topVisibleRowIndex: 0,
    })
  })

  test('updates one expanded key without replacing sibling expansion state', () => {
    const scopeKey = filetreeInteractionScopeKey('repo-a', '/worktree/a')
    useFiletreeInteractionStore.getState().setExpandedKeys(scopeKey, ['src'])

    useFiletreeInteractionStore.getState().setExpandedKey(scopeKey, 'docs', true)
    useFiletreeInteractionStore.getState().setExpandedKey(scopeKey, 'src', false)

    expect(useFiletreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: [],
      expandedKeys: ['docs'],
      topVisibleRowIndex: 0,
    })
  })

  test('stores top visible row index in the same file tree interaction scope', () => {
    const scopeKey = filetreeInteractionScopeKey('repo-a', '/worktree/a')

    useFiletreeInteractionStore.getState().setTopVisibleRowIndex(scopeKey, 240)

    expect(useFiletreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: [],
      expandedKeys: [],
      topVisibleRowIndex: 240,
    })
  })

  test('restored view state replaces existing file tree interaction state', () => {
    const staleScopeKey = filetreeInteractionScopeKey('repo-a', '/worktree/stale')
    const restoredScopeKey = filetreeInteractionScopeKey('repo-a', '/worktree/restored')
    useFiletreeInteractionStore.getState().setExpandedKeys(staleScopeKey, ['old'])

    useFiletreeInteractionStore.getState().restoreViewState({
      [restoredScopeKey]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 12,
      },
    })

    expect(useFiletreeInteractionStore.getState().interactionByScope).toEqual({
      [restoredScopeKey]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 12,
      },
    })
  })

  test('reset clears remembered file tree interaction state', () => {
    const scopeKey = filetreeInteractionScopeKey('repo-a', '/worktree/a')
    useFiletreeInteractionStore.getState().setExpandedKeys(scopeKey, ['src'])

    resetFiletreeInteractionStore()

    expect(useFiletreeInteractionStore.getState().interactionByScope).toEqual({})
  })
})
