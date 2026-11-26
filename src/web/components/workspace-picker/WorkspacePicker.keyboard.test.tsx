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
    const onActivate = vi.fn<(id: WorkspacePickerItem['id'], onCommit?: () => void) => void>()

    renderInJsdom(
      <WorkspacePicker
        workspaces={[
          workspace('workspace-a', 'goblin+file:///tmp/workspace-a'),
          workspace('workspace-b', 'goblin+file:///tmp/workspace-b'),
        ]}
        currentWorkspaceId={workspaceIdForTest('goblin+file:///tmp/workspace-a')}
        showActiveWorkspaceOnly={false}
        onShowActiveWorkspaceOnlyChange={() => {}}
        labels={labels}
        onActivate={onActivate}
        onOpenDashboard={() => {}}
        refreshOrder={async () => []}
        movePending={false}
        onMove={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const first = screen.getByRole('button', { name: 'workspace-a' })
    const second = screen.getByRole('button', { name: 'workspace-b' })
    first.focus()
    await user.keyboard('{ArrowDown}')

    expect(document.activeElement).toBe(first)
    expect(onActivate).toHaveBeenCalledWith('goblin+file:///tmp/workspace-b', expect.any(Function))
    const onCommit = onActivate.mock.calls[0]?.[1]
    onCommit?.()
    expect(document.activeElement).toBe(second)
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
  filter: 'Filter workspaces',
  filterStatus: 'All workspaces',
  close: 'Close',
  moveFirst: 'Move to top',
  moveLast: 'Move to bottom',
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
