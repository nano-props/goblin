// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoPicker } from '#/web/components/repo-picker/RepoPicker.tsx'
import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

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
  vi.unstubAllGlobals()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoPicker', () => {
  test('keeps the switcher trigger outside the current repo group', () => {
    render(
      <RepoPicker
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const currentRepoGroup = document.body.querySelector('[data-current-repo-group]')
    expect(currentRepoGroup).not.toBeNull()
    expect(currentRepoGroup?.querySelector('[data-current-repo-id="/tmp/repo-a"]')).not.toBeNull()
    expect(currentRepoGroup?.querySelector('[aria-label="More"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="More"]')).not.toBeNull()
  })

  test('exposes the current repo button as a selected tab in a horizontal tablist', () => {
    render(
      <RepoPicker
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const tablist = document.body.querySelector('[data-current-repo-group]')
    expect(tablist?.getAttribute('role')).toBe('tablist')
    expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal')

    const activeTab = document.body.querySelector('[data-current-repo-id="/tmp/repo-a"]')
    if (!(activeTab instanceof HTMLButtonElement)) throw new Error('missing current repo tab')
    expect(activeTab.getAttribute('role')).toBe('tab')
    expect(activeTab.getAttribute('aria-selected')).toBe('true')
    expect(activeTab.tabIndex).toBe(0)
  })

  test('shows the active repo in the repo switcher popover with selected styling', async () => {
    render(
      <RepoPicker
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
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

  test('renders only the active repo button when multiple repos are open, with the rest in the switcher popover', () => {
    vi.stubGlobal('matchMedia', createMatchMedia(false))

    render(
      <RepoPicker
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b'), repo('repo-c', '/tmp/repo-c')]}
        activeId="/tmp/repo-b"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    expect(document.body.querySelector('[data-current-repo-id="/tmp/repo-b"]')).not.toBeNull()
    expect(document.body.querySelector('[data-current-repo-id="/tmp/repo-a"]')).toBeNull()
    expect(document.body.querySelector('[data-current-repo-id="/tmp/repo-c"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="More"]')).not.toBeNull()
  })

  test('keeps current repo chrome borderless with hover while leaving close action in the repo switcher popover', async () => {
    render(
      <RepoPicker
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const currentRepoButton = document.body.querySelector('[data-current-repo-id="/tmp/repo-a"]')
    if (!(currentRepoButton instanceof HTMLButtonElement)) throw new Error('missing current repo button')

    const currentRepoChrome = currentRepoButton.closest('[data-current-repo-chrome]')
    expect(currentRepoChrome?.className).toContain('border-transparent')
    expect(currentRepoChrome?.className).not.toContain('border-separator')
    expect(currentRepoChrome?.className).toContain('hover:bg-accent/70')
    expect(currentRepoChrome?.className).toContain('hover:text-foreground')
    expect(currentRepoChrome?.querySelector('button[aria-label="Close repo-a"]')).toBeNull()

    const trigger = document.body.querySelector('button[aria-label="More"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing more trigger')
    expect(
      trigger.parentElement?.querySelector(':scope > [data-slot="separator"][data-orientation="vertical"]'),
    ).not.toBeNull()

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

function repo(name: string, id: string): RepoPickerRepo {
  return { id, name, remoteDetails: [], lastSyncedAt: null, lifecycle: null }
}

const labels = {
  repositories: 'Repositories',
  closeWithName: (name: string) => `Close ${name}`,
  more: 'More',
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
