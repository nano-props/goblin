// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoPicker } from '#/web/components/repo-picker/RepoPicker.tsx'
import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

beforeEach(() => {
  vi.stubGlobal('matchMedia', createMatchMedia(false))
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})

describe('RepoPicker keyboard navigation', () => {
  test('moves between repos from the current repo button', () => {
    const onActivate = vi.fn()

    renderInJsdom(
      <RepoPicker
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={onActivate}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const currentRepoButton = document.body.querySelector('[data-current-repo-id="/tmp/repo-a"]')
    if (!(currentRepoButton instanceof HTMLButtonElement)) throw new Error('missing current repo button')

    act(() => {
      currentRepoButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }),
      )
    })

    expect(onActivate).toHaveBeenCalledWith('/tmp/repo-b')
  })

  test('moves between repos from the sidebar current repo button', () => {
    const onActivate = vi.fn()

    renderInJsdom(
      <RepoPicker
        repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
        activeId="/tmp/repo-a"
        labels={labels}
        onActivate={onActivate}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
        surface="sidebar"
      />,
    )

    const currentRepoButton = document.body.querySelector('[data-current-repo-id="/tmp/repo-a"]')
    if (!(currentRepoButton instanceof HTMLButtonElement)) throw new Error('missing current repo button')

    act(() => {
      currentRepoButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }),
      )
    })

    expect(onActivate).toHaveBeenCalledWith('/tmp/repo-b')
  })
})

function repo(name: string, id: string): RepoPickerRepo {
  return { id, name, remoteDetails: [], lastSyncedAt: null, lifecycle: null }
}

const labels = {
  repositories: 'Repositories',
  closeWithName: (name: string) => `Close ${name}`,
  open: 'Open',
  placeholder: 'Select repository',
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
