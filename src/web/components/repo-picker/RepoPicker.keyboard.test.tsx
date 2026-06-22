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
  vi.stubGlobal('matchMedia', createMatchMedia(false))
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
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
  vi.restoreAllMocks()
})

describe('RepoPicker keyboard navigation', () => {
  test('moves between repos from the current repo button', () => {
    const onActivate = vi.fn()

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
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
    })

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
