// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
let keyboardSensorToken: object
let pointerSensorToken: object
let sortableOnKeyDown: ReturnType<typeof vi.fn>
let useSensorMock: ReturnType<typeof vi.fn>
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.resetModules()
  keyboardSensorToken = {}
  pointerSensorToken = {}
  sortableOnKeyDown = vi.fn()
  useSensorMock = vi.fn((sensor, options) => ({ sensor, options }))

  vi.doMock('@dnd-kit/core', () => ({
    DndContext: ({ children }: { children: unknown }) => children,
    KeyboardSensor: keyboardSensorToken,
    PointerSensor: pointerSensorToken,
    closestCenter: vi.fn(),
    useSensor: useSensorMock,
    useSensors: (...sensors: unknown[]) => sensors,
  }))
  vi.doMock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: { children: unknown }) => children,
    horizontalListSortingStrategy: {},
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: () => ({
      attributes: {},
      listeners: { onKeyDown: sortableOnKeyDown },
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  }))
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
  vi.doUnmock('@dnd-kit/core')
  vi.doUnmock('@dnd-kit/sortable')
  vi.restoreAllMocks()
})

describe('RepoTabStrip keyboard dnd wiring', () => {
  test('registers a KeyboardSensor and preserves sortable onKeyDown listeners', async () => {
    const { RepoTabStrip } = await import('#/web/components/repo-tabs/RepoTabStrip.tsx')
    const onActivate = vi.fn()

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <RepoTabStrip
          repos={[repo('repo-a', '/tmp/repo-a'), repo('repo-b', '/tmp/repo-b')]}
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
    })

    expect(useSensorMock).toHaveBeenCalledWith(pointerSensorToken, { activationConstraint: { distance: 6 } })
    expect(useSensorMock).toHaveBeenCalledWith(
      keyboardSensorToken,
      expect.objectContaining({ coordinateGetter: expect.any(Function) }),
    )

    const tab = document.body.querySelector('[data-repo-tab-id="/tmp/repo-a"]')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing repo tab')

    act(() => {
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }))
    })

    expect(sortableOnKeyDown).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith('/tmp/repo-b')
  })
})

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
