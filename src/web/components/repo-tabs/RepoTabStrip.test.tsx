// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoTabStrip } from '#/web/components/repo-tabs/RepoTabStrip.tsx'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoTabStrip', () => {
  test('keeps the overflow menu trigger outside the tablist on small screens', () => {
    render(
      <RepoTabStrip
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const tablist = document.body.querySelector('[role="tablist"]')
    expect(tablist).not.toBeNull()
    expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal')
    expect(tablist?.querySelector('[role="tab"]')).not.toBeNull()
    expect(tablist?.querySelector('[aria-label="More"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="More"]')).not.toBeNull()
  })

  test('shows the active repo in the small-screen dropdown with selected styling', async () => {
    render(
      <RepoTabStrip
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const trigger = document.body.querySelector('button[aria-label="More"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing more trigger')

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const selectedItem = [...document.body.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes('repo-a'),
    )
    expect(selectedItem?.getAttribute('aria-current')).toBe('true')
  })

  test('moves focus through the full tab strip with keyboard navigation on large screens', () => {
    vi.stubGlobal('matchMedia', createMatchMedia(false))
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    const onActivate = vi.fn()

    render(
      <RepoTabStrip
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b'), repo('repo-c', '/tmp/repo-c')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={onActivate}
        onClose={() => {}}
        onReorder={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const repoA = document.body.querySelector('[data-repo-tab-id="/tmp/repo-a"]')
    const repoB = document.body.querySelector('[data-repo-tab-id="/tmp/repo-b"]')
    const repoC = document.body.querySelector('[data-repo-tab-id="/tmp/repo-c"]')
    if (
      !(repoA instanceof HTMLButtonElement) ||
      !(repoB instanceof HTMLButtonElement) ||
      !(repoC instanceof HTMLButtonElement)
    ) {
      throw new Error('missing repo tab buttons')
    }

    act(() => {
      repoA.focus()
      repoA.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(onActivate).toHaveBeenNthCalledWith(1, '/tmp/repo-b')
    expect(document.activeElement).toBe(repoB)

    act(() => {
      repoB.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(onActivate).toHaveBeenNthCalledWith(2, '/tmp/repo-c')
    expect(document.activeElement).toBe(repoC)

    act(() => {
      repoC.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(onActivate).toHaveBeenNthCalledWith(3, '/tmp/repo-a')
    expect(document.activeElement).toBe(repoA)
  })
})

function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function repo(name: string, id: string): RepoTabSummary {
  return { id, name, remoteDetails: [] }
}

const labels = {
  repositories: 'Repositories',
  closeWithName: (name: string) => `Close ${name}`,
  more: 'More',
  dragToReorder: 'Drag to reorder',
  open: 'Open',
  openLocal: 'Open local repository…',
  openLocalShortcut: '⌘O',
  openRemote: 'Open remote repository…',
  openRemoteShortcut: '⌘⇧R',
  clone: 'Clone repository…',
  cloneShortcut: '⌘⇧O',
  unavailable: 'Unavailable',
}

function createMatchMedia(matches: boolean) {
  return (query: string) => ({
    matches: query === '(max-width: 639px)' ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}
