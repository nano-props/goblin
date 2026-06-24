// Smoke test for the UI transition store. The store is read by
// `useKeyboard` to suppress branch-action shortcuts during the
// 240 ms compact-workspace pane transition (the workspace renders
// the OLD branch while the live store has moved to the NEW one —
// without suppression, a keypress would act on the new branch while
// the user sees the old).

import { beforeEach, describe, expect, test } from 'vitest'
import { useUiTransitionStore } from '#/web/stores/ui-transition.ts'

describe('useUiTransitionStore', () => {
  beforeEach(() => {
    useUiTransitionStore.setState({ isCompactWorkspaceTransitioning: false })
  })

  test('initial state is not transitioning', () => {
    expect(useUiTransitionStore.getState().isCompactWorkspaceTransitioning).toBe(false)
  })

  test('setCompactWorkspaceTransitioning flips the flag', () => {
    useUiTransitionStore.getState().setCompactWorkspaceTransitioning(true)
    expect(useUiTransitionStore.getState().isCompactWorkspaceTransitioning).toBe(true)
    useUiTransitionStore.getState().setCompactWorkspaceTransitioning(false)
    expect(useUiTransitionStore.getState().isCompactWorkspaceTransitioning).toBe(false)
  })
})
