import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  filetreeInteractionScopeKey,
  parseFiletreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  filetreeInteractionStore,
} from '#/web/stores/workspaces/filetree-interaction-state.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspaces/example')

describe('filetreeInteractionStore', () => {
  beforeEach(() => {
    resetFiletreeInteractionStore()
  })

  test('stores selected and expanded keys by repo worktree scope', async () => {
    const scopeA = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/a')
    const scopeB = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/b')

    filetreeInteractionStore.getState().setSelectedKeys(scopeA, ['src/index.ts'])
    filetreeInteractionStore.getState().setExpandedKeys(scopeA, ['src', 'src/web'])
    filetreeInteractionStore.getState().setExpandedKeys(scopeB, ['docs'])

    expect(filetreeInteractionStore.getState().interactionByScope[scopeA]).toEqual({
      selectedKeys: ['src/index.ts'],
      expandedKeys: ['src', 'src/web'],
      topVisibleRowIndex: 0,
    })
    expect(filetreeInteractionStore.getState().interactionByScope[scopeB]).toEqual({
      selectedKeys: [],
      expandedKeys: ['docs'],
      topVisibleRowIndex: 0,
    })
  })

  test('prunes keys that no longer exist in the loaded tree', async () => {
    const scopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/a')
    filetreeInteractionStore.getState().setSelectedKeys(scopeKey, ['README.md'])
    filetreeInteractionStore.getState().setExpandedKeys(scopeKey, ['src', 'docs'])

    filetreeInteractionStore.getState().pruneKeys(scopeKey, new Set(['src', 'src/index.ts']))

    expect(filetreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: [],
      expandedKeys: ['src'],
      topVisibleRowIndex: 0,
    })
  })

  test('keeps remembered lazy descendants until a loaded ancestor disproves them', async () => {
    const scopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/a')
    filetreeInteractionStore.getState().setSelectedKeys(scopeKey, ['src/web/index.ts'])
    filetreeInteractionStore.getState().setExpandedKeys(scopeKey, ['src', 'src/web'])

    filetreeInteractionStore.getState().pruneKeys(scopeKey, new Set(['src']), new Set(['']))

    expect(filetreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: ['src/web/index.ts'],
      expandedKeys: ['src', 'src/web'],
      topVisibleRowIndex: 0,
    })

    filetreeInteractionStore.getState().pruneKeys(scopeKey, new Set(['src', 'src/app']), new Set(['', 'src']))

    expect(filetreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: [],
      expandedKeys: ['src'],
      topVisibleRowIndex: 0,
    })
  })

  test('updates one expanded key without replacing sibling expansion state', async () => {
    const scopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/a')
    filetreeInteractionStore.getState().setExpandedKeys(scopeKey, ['src'])

    filetreeInteractionStore.getState().setExpandedKey(scopeKey, 'docs', true)
    filetreeInteractionStore.getState().setExpandedKey(scopeKey, 'src', false)

    expect(filetreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: [],
      expandedKeys: ['docs'],
      topVisibleRowIndex: 0,
    })
  })

  test('stores top visible row index in the same file tree interaction scope', async () => {
    const scopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/a')

    filetreeInteractionStore.getState().setTopVisibleRowIndex(scopeKey, 240)

    expect(filetreeInteractionStore.getState().interactionByScope[scopeKey]).toEqual({
      selectedKeys: [],
      expandedKeys: [],
      topVisibleRowIndex: 240,
    })
  })

  test('restored view state replaces existing file tree interaction state', async () => {
    const staleScopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/stale')
    const restoredScopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/restored')
    filetreeInteractionStore.getState().setExpandedKeys(staleScopeKey, ['old'])

    filetreeInteractionStore.getState().restoreViewState({
      [restoredScopeKey]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 12,
      },
    })

    expect(filetreeInteractionStore.getState().interactionByScope).toEqual({
      [restoredScopeKey]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 12,
      },
    })
  })

  test('rejects malformed and noncanonical workspace identities while restoring scope keys', async () => {
    const validScopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/valid')
    const malformedScopeKey = 'not-a-workspace\0/worktree/malformed'
    const noncanonicalScopeKey = 'goblin+file:///workspaces/%65xample\0/worktree/noncanonical'
    const snapshot = {
      selectedKeys: ['src/index.ts'],
      expandedKeys: ['src'],
      topVisibleRowIndex: 4,
    }

    expect(parseFiletreeInteractionScopeKey(malformedScopeKey)).toBeNull()
    expect(parseFiletreeInteractionScopeKey(noncanonicalScopeKey)).toBeNull()

    filetreeInteractionStore.getState().restoreViewState({
      [malformedScopeKey]: snapshot,
      [noncanonicalScopeKey]: snapshot,
      [validScopeKey]: snapshot,
    })

    expect(filetreeInteractionStore.getState().interactionByScope).toEqual({
      [validScopeKey]: snapshot,
    })
  })

  test('reset clears remembered file tree interaction state', async () => {
    const scopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/worktree/a')
    filetreeInteractionStore.getState().setExpandedKeys(scopeKey, ['src'])

    resetFiletreeInteractionStore()

    expect(filetreeInteractionStore.getState().interactionByScope).toEqual({})
  })
})
