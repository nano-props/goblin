// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { FiletreeActionDialogHost } from '#/web/components/FiletreeActionDialogHost.tsx'
import {
  resetFiletreeActionDialogsStore,
  useFiletreeActionDialogsStore,
} from '#/web/stores/workspaces/filetree-action-dialogs.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')

const dialogProps = vi.hoisted(() => ({
  latest: { open: false, title: '', message: null as unknown },
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => {
    if (key === 'filetree.confirm-trash-body') return 'Move to trash:'
    return key
  },
}))

vi.mock('#/web/components/ConfirmDialog.tsx', () => ({
  ConfirmDialog: ({ open, title, message }: { open: boolean; title: string; message: unknown }) => {
    dialogProps.latest = { open, title, message }
    return null
  },
}))

beforeEach(() => {
  resetFiletreeActionDialogsStore()
  dialogProps.latest = { open: false, title: '', message: null }
})

afterEach(() => {
  resetFiletreeActionDialogsStore()
  cleanup()
  vi.restoreAllMocks()
})

describe('FiletreeActionDialogHost', () => {
  test('retains the file path message while the close animation runs after store state is cleared', () => {
    renderInJsdom(
      <FiletreeActionDialogHost
        currentWorkspaceId={WORKSPACE_ID}
        currentWorkspaceRuntimeId="workspace-runtime-filetree-action-test"
      />,
    )

    act(() => {
      useFiletreeActionDialogsStore.getState().openTrashFileConfirm({
        target: {
          kind: 'workspace-root',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: 'workspace-runtime-filetree-action-test',
        },
        path: 'src/example.ts',
        name: 'example.ts',
      })
    })

    expect(dialogProps.latest).toMatchObject({
      open: true,
    })
    expect(renderMessageText(dialogProps.latest.message)).toContain('Move to trash:')
    expect(renderMessageText(dialogProps.latest.message)).toContain('src/example.ts')

    act(() => {
      useFiletreeActionDialogsStore.getState().closeTrashFileConfirm()
    })

    expect(dialogProps.latest).toMatchObject({
      open: false,
    })
    expect(renderMessageText(dialogProps.latest.message)).toContain('Move to trash:')
    expect(renderMessageText(dialogProps.latest.message)).toContain('src/example.ts')
  })

  test('closes a confirmation bound to an earlier runtime of the same workspace', () => {
    useFiletreeActionDialogsStore.getState().openTrashFileConfirm({
      target: {
        kind: 'workspace-root',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: 'workspace-runtime-previous',
      },
      path: 'src/example.ts',
      name: 'example.ts',
    })

    renderInJsdom(
      <FiletreeActionDialogHost
        currentWorkspaceId={WORKSPACE_ID}
        currentWorkspaceRuntimeId="workspace-runtime-current"
      />,
    )

    expect(useFiletreeActionDialogsStore.getState().trashFileConfirm).toBeNull()
    expect(dialogProps.latest.open).toBe(false)
  })
})

function renderMessageText(message: unknown): string {
  const { container, unmount } = renderInJsdom(<>{message as React.ReactNode}</>)
  const text = container.textContent ?? ''
  unmount()
  return text
}
