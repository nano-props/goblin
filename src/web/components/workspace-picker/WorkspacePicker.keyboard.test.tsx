// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
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
  test('moves between workspaces from the sidebar project list', async () => {
    const user = userEvent.setup()
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

    screen.getByRole('button', { name: 'workspace-a' }).focus()
    await user.keyboard('{ArrowDown}')

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'workspace-b' }))

    expect(onActivate).toHaveBeenCalledWith('goblin+file:///tmp/workspace-b')
  })

  test('reveals the workspace selected outside the list without moving focus', async () => {
    const first = workspace('workspace-a', 'goblin+file:///tmp/workspace-a')
    const second = workspace('workspace-b', 'goblin+file:///tmp/workspace-b')
    const { rerender } = renderInJsdom(WorkspacePicker, {
      props: {
        workspaces: [first, second],
        currentWorkspaceId: first.id,
        labels,
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onOpenLocal: vi.fn(),
        onOpenRemote: vi.fn(),
        onClone: vi.fn(),
      },
    })

    const addButton = screen.getByRole('button', { name: labels.open })
    addButton.focus()
    const workspaceButton = screen.getByRole('button', { name: second.name })
    const scrollIntoView = vi.fn()
    workspaceButton.scrollIntoView = scrollIntoView

    await rerender({ currentWorkspaceId: second.id })

    expect(workspaceButton.getAttribute('aria-current')).toBe('true')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(document.activeElement).toBe(addButton)
  })
})

function workspace(name: string, id: string): WorkspacePickerItem {
  return {
    id: workspaceIdForTest(id),
    name,
    gitAvailable: true,
    lifecycle: null,
  }
}

const labels = {
  workspaces: 'Workspaces',
  closeWithName: (name: string) => `Close ${name}`,
  open: 'Open',
  openLocal: 'Open local repository…',
  openRemote: 'Open remote repository…',
  clone: 'Clone repository…',
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
