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
  test('keeps the overflow popover trigger outside the tablist on small screens', () => {
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

  test('shows the active repo in the repo switcher popover with selected styling', async () => {
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

    const selectedItem = [...document.body.querySelectorAll('button[aria-current="true"]')].find((item) =>
      item.textContent?.includes('repo-a'),
    )
    expect(selectedItem).not.toBeNull()
    expect(selectedItem?.className).toContain('bg-selected')
  })

  test('renders only the active repo tab when multiple repos are open, with the rest in the overflow popover', () => {
    vi.stubGlobal('matchMedia', createMatchMedia(false))

    render(
      <RepoTabStrip
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b'), repo('repo-c', '/tmp/repo-c')]}
        activeId="/tmp/repo-b"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    // Only the active repo is rendered as a tab; every other repo lives
    // behind the overflow popover trigger.
    expect(document.body.querySelector('[data-repo-tab-id="/tmp/repo-b"]')).not.toBeNull()
    expect(document.body.querySelector('[data-repo-tab-id="/tmp/repo-a"]')).toBeNull()
    expect(document.body.querySelector('[data-repo-tab-id="/tmp/repo-c"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="More"]')).not.toBeNull()
  })

  test('keeps repo tab chrome borderless with hover while leaving close action in the repo switcher popover', async () => {
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

    const tab = document.body.querySelector('[data-repo-tab-id="/tmp/repo-a"]')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing repo tab')

    const tabChrome = tab.closest('[role="presentation"]')
    expect(tabChrome?.className).toContain('border-transparent')
    expect(tabChrome?.className).not.toContain('border-separator')
    expect(tabChrome?.className).toContain('hover:bg-accent/70')
    expect(tabChrome?.className).toContain('hover:text-foreground')
    expect(tabChrome?.querySelector('button[aria-label="Close repo-a"]')).toBeNull()

    const trigger = document.body.querySelector('button[aria-label="More"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing more trigger')
    expect(trigger.parentElement?.querySelector(':scope > .pointer-events-none.border-l.border-separator')).not.toBeNull()

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const closeButton = document.body.querySelector('button[aria-label="Close repo-a"]')
    expect(closeButton).not.toBeNull()
    expect(closeButton?.className).not.toContain('opacity-0')
    expect(closeButton?.className).not.toContain('group-hover:opacity-100')
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
  return { id, name, remoteDetails: [], lifecycle: null, unavailable: false }
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
