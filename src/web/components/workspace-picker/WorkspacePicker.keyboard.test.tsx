// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePicker } from '#/web/components/workspace-picker/WorkspacePicker.tsx'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

beforeEach(() => {
  vi.stubGlobal('matchMedia', createMatchMedia(false))
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})

describe('WorkspacePicker keyboard navigation', () => {
  test('moves between workspaces from the current workspace button', () => {
    const onActivate = vi.fn()

    renderInJsdom(
      <WorkspacePicker
        workspaces={[
          workspace('workspace-a', 'goblin+file:///tmp/workspace-a'),
          workspace('workspace-b', 'goblin+file:///tmp/workspace-b'),
        ]}
        currentWorkspaceId={workspaceIdForTest('goblin+file:///tmp/workspace-a')}
        labels={labels}
        onActivate={onActivate}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const currentWorkspaceButton = document.body.querySelector(
      '[data-current-workspace-id="goblin+file:///tmp/workspace-a"]',
    )
    if (!(currentWorkspaceButton instanceof HTMLButtonElement)) throw new Error('missing current workspace button')

    act(() => {
      currentWorkspaceButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }),
      )
    })

    expect(onActivate).toHaveBeenCalledWith('goblin+file:///tmp/workspace-b')
  })

  test('moves between workspaces from the sidebar current workspace button', () => {
    const onActivate = vi.fn()

    renderInJsdom(
      <WorkspacePicker
        workspaces={[
          workspace('workspace-a', 'goblin+file:///tmp/workspace-a'),
          workspace('workspace-b', 'goblin+file:///tmp/workspace-b'),
        ]}
        currentWorkspaceId={workspaceIdForTest('goblin+file:///tmp/workspace-a')}
        labels={labels}
        onActivate={onActivate}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
        surface="sidebar"
      />,
    )

    const currentWorkspaceButton = document.body.querySelector(
      '[data-current-workspace-id="goblin+file:///tmp/workspace-a"]',
    )
    if (!(currentWorkspaceButton instanceof HTMLButtonElement)) throw new Error('missing current workspace button')

    act(() => {
      currentWorkspaceButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }),
      )
    })

    expect(onActivate).toHaveBeenCalledWith('goblin+file:///tmp/workspace-b')
  })
})

function workspace(name: string, id: string): WorkspacePickerItem {
  return {
    id: workspaceIdForTest(id),
    name,
    gitCapability: 'available',
    git: { remoteDetails: [] },
    lifecycle: null,
  }
}

const labels = {
  workspaces: 'Workspaces',
  closeWithName: (name: string) => `Close ${name}`,
  open: 'Open',
  placeholder: 'Select workspace',
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
