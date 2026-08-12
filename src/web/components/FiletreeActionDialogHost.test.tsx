// @vitest-environment jsdom

import { cleanup } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { FiletreeActionDialogHost } from '#/web/components/FiletreeActionDialogHost.tsx'
import {
  resetFiletreeActionDialogsStore,
  filetreeActionDialogsStore,
} from '#/web/stores/workspaces/filetree-action-dialogs.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { VNodeChild } from 'vue'
import { appI18n } from '#/web/stores/i18n-vue.ts'
import { CodedError } from '#/shared/coded-error.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')

const dialogProps = vi.hoisted(() => ({
  latest: { open: false, title: '', message: null as unknown, onConfirm: async () => {} },
}))

const actionMocks = vi.hoisted(() => ({ trashWorkspaceFile: vi.fn(), warning: vi.fn() }))

vi.mock('#/web/workspace-filesystem-client.ts', () => ({ trashWorkspaceFile: actionMocks.trashWorkspaceFile }))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), warning: actionMocks.warning } }))

vi.mock('#/web/components/ConfirmDialog.tsx', () => ({
  ConfirmDialog: ({
    open,
    title,
    message,
    onConfirm,
  }: {
    open: boolean
    title: string
    message: unknown
    onConfirm: () => Promise<void>
  }) => {
    dialogProps.latest = { open, title, message, onConfirm }
    return null
  },
}))

beforeEach(() => {
  appI18n.global.setLocaleMessage('en', { 'filetree.confirm-trash-body': 'Move to trash:' })
  appI18n.global.locale.value = 'en'
  resetFiletreeActionDialogsStore()
  dialogProps.latest = { open: false, title: '', message: null, onConfirm: async () => {} }
  actionMocks.trashWorkspaceFile.mockReset()
  actionMocks.warning.mockReset()
})

afterEach(() => {
  resetFiletreeActionDialogsStore()
  cleanup()
  vi.restoreAllMocks()
})

describe('FiletreeActionDialogHost', () => {
  test('retains the file path message while the close animation runs after store state is cleared', async () => {
    renderInJsdom(
      <FiletreeActionDialogHost
        currentWorkspaceId={WORKSPACE_ID}
        currentWorkspaceRuntimeId="workspace-runtime-filetree-action-test"
      />,
    )

    await flushTestUpdates(() => {
      filetreeActionDialogsStore.getState().openTrashFileConfirm({
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

    await flushTestUpdates(() => {
      filetreeActionDialogsStore.getState().closeTrashFileConfirm()
    })

    expect(dialogProps.latest).toMatchObject({
      open: false,
    })
    expect(renderMessageText(dialogProps.latest.message)).toContain('Move to trash:')
    expect(renderMessageText(dialogProps.latest.message)).toContain('src/example.ts')
  })

  test('closes a confirmation bound to an earlier runtime of the same workspace', async () => {
    filetreeActionDialogsStore.getState().openTrashFileConfirm({
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

    expect(filetreeActionDialogsStore.getState().trashFileConfirm).toBeNull()
    expect(dialogProps.latest.open).toBe(false)
  })

  test('closes the confirmation and directs recovery to the file tree for an uncertain trash outcome', async () => {
    actionMocks.trashWorkspaceFile.mockRejectedValueOnce(
      new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'response lost' }),
    )
    renderInJsdom(
      <FiletreeActionDialogHost
        currentWorkspaceId={WORKSPACE_ID}
        currentWorkspaceRuntimeId="workspace-runtime-filetree-action-test"
      />,
    )
    await flushTestUpdates(() => {
      filetreeActionDialogsStore.getState().openTrashFileConfirm({
        target: {
          kind: 'workspace-root',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: 'workspace-runtime-filetree-action-test',
        },
        path: 'src/example.ts',
        name: 'example.ts',
      })
    })

    await flushTestUpdates(async () => await dialogProps.latest.onConfirm())

    expect(filetreeActionDialogsStore.getState().trashFileConfirm).toBeNull()
    expect(actionMocks.warning).toHaveBeenCalledWith('error.trash-file-outcome-uncertain')
  })
})

function renderMessageText(message: unknown): string {
  const { container, unmount } = renderInJsdom(<>{message as VNodeChild}</>)
  const text = container.textContent ?? ''
  unmount()
  return text
}
