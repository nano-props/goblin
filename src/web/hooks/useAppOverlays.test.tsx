// @vitest-environment jsdom

import { act } from 'react'
import { useState } from 'react'
import { beforeEach, describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'

function Harness() {
  const overlays = useAppOverlays()

  return (
    <>
      <button id="open-clone" type="button" onClick={overlays.openCloneRepo}>
        open clone
      </button>
      <button id="open-repo" type="button" onClick={overlays.openRepoPathDialog}>
        open repo
      </button>
      <button id="open-create-worktree" type="button" onClick={overlays.openCreateWorktree}>
        open create worktree
      </button>
      <button id="close-all" type="button" onClick={overlays.closeAllOverlays}>
        close all
      </button>
      <output id="clone-open">{overlays.state.clone.open ? 'open' : 'closed'}</output>
      <output id="open-repo-open">{overlays.state.openRepo.open ? 'open' : 'closed'}</output>
      <output id="create-worktree-open">{overlays.state.createWorktree.open ? 'open' : 'closed'}</output>
      <output id="any-open">{overlays.anyOpen ? 'open' : 'closed'}</output>
    </>
  )
}

function RoutedHarness() {
  const [overlay, setOverlay] = useState<'clone' | 'openRepo' | 'openRemoteRepo' | 'createWorktree' | null>(null)
  const overlays = useAppOverlays({
    routeOverlay: overlay,
    onRouteOverlayChange: setOverlay,
  })

  return (
    <>
      <button id="open-clone" type="button" onClick={overlays.openCloneRepo}>
        open clone
      </button>
      <button id="open-repo" type="button" onClick={overlays.openRepoPathDialog}>
        open repo
      </button>
      <button id="close-all" type="button" onClick={overlays.closeAllOverlays}>
        close all
      </button>
      <output id="clone-open">{overlays.state.clone.open ? 'open' : 'closed'}</output>
      <output id="open-repo-open">{overlays.state.openRepo.open ? 'open' : 'closed'}</output>
      <output id="any-open">{overlays.anyOpen ? 'open' : 'closed'}</output>
    </>
  )
}

beforeEach(() => {
  resetReposStore()
})

describe('useAppOverlays', () => {
  test('tracks non-settings overlays centrally and resets all overlays together', () => {
    // Seed an active repo so the openCreateWorktree defensive
    // guard (in production) does not short-circuit the test.
    seedRepoState({ id: '/tmp/gbl-overlay-test', branches: [] })

    const { container } = renderInJsdom(<Harness />)

    click(container, '#open-clone')
    click(container, '#open-repo')
    click(container, '#open-create-worktree')
    expect(text(container, '#clone-open')).toBe('open')
    expect(text(container, '#open-repo-open')).toBe('open')
    expect(text(container, '#create-worktree-open')).toBe('open')
    expect(text(container, '#any-open')).toBe('open')

    click(container, '#close-all')
    expect(text(container, '#clone-open')).toBe('closed')
    expect(text(container, '#open-repo-open')).toBe('closed')
    expect(text(container, '#create-worktree-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('closed')
  })

  test('can derive overlay state from a routed overlay source', () => {
    const { container } = renderInJsdom(<RoutedHarness />)

    click(container, '#open-clone')
    expect(text(container, '#clone-open')).toBe('open')
    expect(text(container, '#open-repo-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('open')

    click(container, '#open-repo')
    expect(text(container, '#clone-open')).toBe('closed')
    expect(text(container, '#open-repo-open')).toBe('open')

    click(container, '#close-all')
    expect(text(container, '#clone-open')).toBe('closed')
    expect(text(container, '#open-repo-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('closed')
  })

  test('openCreateWorktree no-ops when no active repo (defensive guard)', () => {
    // The create-worktree dialog is repo-scoped — it renders nothing
    // when no active repo. If a future surface (e.g. command-palette
    // entry) calls openCreateWorktree with no active repo, the
    // naive behaviour is `state.createWorktree.open = true` with no
    // dialog visible, and a later `useEffect([activeId])` clears it
    // when a repo is finally activated. The guard short-circuits at
    // the action so the intent is never silently lost.

    // Active repo is null (resetReposStore in beforeEach).
    const { container } = renderInJsdom(<Harness />)

    click(container, '#open-create-worktree')
    expect(text(container, '#create-worktree-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('closed')

    // Now seed an active repo; opening should now work.
    seedRepoState({ id: '/tmp/gbl-overlay-test', branches: [] })
    click(container, '#open-create-worktree')
    expect(text(container, '#create-worktree-open')).toBe('open')
  })
})

function click(container: HTMLElement, selector: string) {
  const element = container.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function text(container: HTMLElement, selector: string): string {
  const element = container.querySelector(selector)
  if (!(element instanceof HTMLOutputElement)) throw new Error(`Missing output: ${selector}`)
  return element.textContent ?? ''
}
