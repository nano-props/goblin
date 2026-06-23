// @vitest-environment jsdom

import { act } from 'react'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

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
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('useAppOverlays', () => {
  test('tracks non-settings overlays centrally and resets all overlays together', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root!.render(<Harness />)
    })

    click('#open-clone')
    click('#open-repo')
    click('#open-create-worktree')
    expect(text('#clone-open')).toBe('open')
    expect(text('#open-repo-open')).toBe('open')
    expect(text('#create-worktree-open')).toBe('open')
    expect(text('#any-open')).toBe('open')

    click('#close-all')
    expect(text('#clone-open')).toBe('closed')
    expect(text('#open-repo-open')).toBe('closed')
    expect(text('#create-worktree-open')).toBe('closed')
    expect(text('#any-open')).toBe('closed')
  })

  test('can derive overlay state from a routed overlay source', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root!.render(<RoutedHarness />)
    })

    click('#open-clone')
    expect(text('#clone-open')).toBe('open')
    expect(text('#open-repo-open')).toBe('closed')
    expect(text('#any-open')).toBe('open')

    click('#open-repo')
    expect(text('#clone-open')).toBe('closed')
    expect(text('#open-repo-open')).toBe('open')

    click('#close-all')
    expect(text('#clone-open')).toBe('closed')
    expect(text('#open-repo-open')).toBe('closed')
    expect(text('#any-open')).toBe('closed')
  })
})

function click(selector: string) {
  const element = container?.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function text(selector: string): string {
  const element = container?.querySelector(selector)
  if (!(element instanceof HTMLOutputElement)) throw new Error(`Missing output: ${selector}`)
  return element.textContent ?? ''
}
