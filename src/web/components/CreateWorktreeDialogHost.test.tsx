// @vitest-environment jsdom

// Regression test for the create-worktree dialog host. The original
// implementation mounted inside the per-repo action subtree and
// lost its form state every time the user navigated to Settings
// because that subtree unmounted. The fix moved the
// host to `Layout.MainWindowOverlays` (outside `<Outlet />`), so the
// dialog survives settings ⇄ workspace navigation.
//
// The subtle regression this protects against is closing the dialog
// on its own false→true transition. The host should only force-close
// when the active repo changes.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CreateWorktreeDialogHost } from '#/web/components/CreateWorktreeDialogHost.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-create-host-test'
let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('main', { isCurrent: true, ahead: 0, behind: 0 })],
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

function renderHost(open: boolean, onOpenChange: (open: boolean) => void) {
  act(() => {
    root!.render(<CreateWorktreeDialogHost open={open} onOpenChange={onOpenChange} activeId={REPO_ID} />)
  })
}

describe('CreateWorktreeDialogHost', () => {
  test('regression: dialog stays open after the false→true transition', () => {
    // The bug: useEffect had `[activeId, onOpenChange, open]` in its
    // deps. When the user clicked the "create worktree" button, the
    // parent's `open` state flipped false→true, the host re-rendered,
    // and the effect fired (because `open` changed), calling
    // `onOpenChange(false)`. The dialog was unopenable from the UI.
    //
    // The fix removes `open` (and the unstable `onOpenChange`) from
    // the dep array, so the effect only fires on `activeId` change.
    // In the real flow the host is mounted in Layout with `open=false`
    // initially; the parent flips to `true` when the user clicks the
    // create-worktree button. This test reproduces that flow.
    const onOpenChange = vi.fn()

    // (1) Initial mount: open=false (the host always starts closed).
    renderHost(false, onOpenChange)
    expect(onOpenChange).not.toHaveBeenCalled()

    // (2) The user clicks the create-worktree button. Parent flips `open` to
    // true. The host re-renders; only `open` changed, not
    // `activeId`. The effect's deps are `[activeId]`, so the effect
    // must NOT fire — pre-fix it did, and called `onOpenChange(false)`
    // in the same render.
    act(() => {
      root!.render(<CreateWorktreeDialogHost open={true} onOpenChange={onOpenChange} activeId={REPO_ID} />)
    })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('does not close merely because it mounted open', () => {
    const onOpenChange = vi.fn()

    renderHost(true, onOpenChange)

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('force-closes the dialog when the active repo changes (matches pre-PR behaviour)', () => {
    const onOpenChange = vi.fn()
    renderHost(true, onOpenChange)

    // Simulate the user switching active repo. The host must call
    // `onOpenChange(false)` so the dialog doesn't leak across the
    // boundary. The `activeId` dep flips, so the effect fires.
    act(() => {
      root!.render(<CreateWorktreeDialogHost open={true} onOpenChange={onOpenChange} activeId="/tmp/other-repo" />)
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('renders nothing when no active repo', () => {
    act(() => {
      root!.render(<CreateWorktreeDialogHost open onOpenChange={vi.fn()} activeId={null} />)
    })
    expect(container?.textContent ?? '').toBe('')
  })
})
