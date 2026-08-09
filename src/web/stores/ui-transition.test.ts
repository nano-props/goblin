// Smoke test for the UI transition store. The store is read by
// `useKeyboard` to suppress branch-action shortcuts during the
// 240 ms compact-workspace pane transition (the workspace renders
// the OLD branch while the live store has moved to the NEW one —
// without suppression, a keypress would act on the new branch while
// the user sees the old).

import { beforeEach, describe, expect, test } from 'vitest'
import { uiTransitionStore } from '#/web/stores/ui-transition.ts'

describe('uiTransitionStore', () => {
  beforeEach(() => {
    uiTransitionStore.setState({ isCompactWorkspaceTransitioning: false })
  })

  test('initial state is not transitioning', async () => {
    expect(uiTransitionStore.getState().isCompactWorkspaceTransitioning).toBe(false)
  })

  test('setCompactWorkspaceTransitioning flips the flag', async () => {
    uiTransitionStore.getState().setCompactWorkspaceTransitioning(true)
    expect(uiTransitionStore.getState().isCompactWorkspaceTransitioning).toBe(true)
    uiTransitionStore.getState().setCompactWorkspaceTransitioning(false)
    expect(uiTransitionStore.getState().isCompactWorkspaceTransitioning).toBe(false)
  })
})
