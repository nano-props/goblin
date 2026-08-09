// @vitest-environment jsdom

import { cleanup } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { TerminalActionDialogHost } from '#/web/components/TerminalActionDialogHost.tsx'
import {
  resetTerminalActionDialogsStore,
  terminalActionDialogsStore,
} from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import type { VNodeChild } from 'vue'
import { appI18n } from '#/web/stores/i18n-vue.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///other-workspace')

const dialogProps = vi.hoisted(() => ({
  latest: { open: false, title: '', message: null as unknown },
}))

vi.mock('#/web/components/ConfirmDialog.tsx', () => ({
  ConfirmDialog: ({ open, title, message }: { open: boolean; title: string; message: unknown }) => {
    dialogProps.latest = { open, title, message }
    return null
  },
}))

beforeEach(() => {
  appI18n.global.setLocaleMessage('en', { 'terminal.confirm-close-running-body': 'process:' })
  appI18n.global.locale.value = 'en'
  resetTerminalActionDialogsStore()
  dialogProps.latest = { open: false, title: '', message: null }
})

afterEach(() => {
  resetTerminalActionDialogsStore()
  cleanup()
})

describe('TerminalActionDialogHost', () => {
  test('retains the process message while the close animation runs after store state is cleared', async () => {
    renderInJsdom(
      <TerminalActionDialogHost
        currentWorkspaceId={WORKSPACE_ID}
        currentWorkspacePaneRoute={{ kind: 'terminal', terminalSessionId: 'term-111111111111111111111' }}
        navigation={appNavigationActionsForTest()}
      />,
    )

    await flushTestUpdates(() => {
      terminalActionDialogsStore.getState().openCloseConfirm({
        workspaceId: WORKSPACE_ID,
        routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'main' },
        targetIdentity: 'terminal:term-111111111111111111111',
        selectedIdentity: 'terminal:term-111111111111111111111',
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        terminalSessionId: 'term-111111111111111111111',
        terminalBase: terminalSessionBaseForTest({
          repoRoot: '/repo',
          workspaceRuntimeId: 'repo-runtime-test',
          branch: 'main',
          worktreePath: '/repo-worktree',
        }),
        processName: 'node',
      })
    })

    expect(dialogProps.latest).toMatchObject({
      open: true,
    })
    expect(renderMessageText(dialogProps.latest.message)).toContain('process:')
    expect(renderMessageText(dialogProps.latest.message)).toContain('node')

    await flushTestUpdates(() => {
      terminalActionDialogsStore.getState().closeCloseConfirm()
    })

    expect(dialogProps.latest).toMatchObject({
      open: false,
    })
    expect(renderMessageText(dialogProps.latest.message)).toContain('process:')
    expect(renderMessageText(dialogProps.latest.message)).toContain('node')
  })

  test('abandons a close confirmation opened after its workspace is no longer current', async () => {
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }
    renderInJsdom(
      <TerminalActionDialogHost
        currentWorkspaceId={OTHER_WORKSPACE_ID}
        currentWorkspacePaneRoute={null}
        navigation={appNavigationActionsForTest()}
      />,
    )

    await flushTestUpdates(() => {
      terminalActionDialogsStore.getState().openCloseConfirm({
        workspaceId: WORKSPACE_ID,
        routeTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        targetIdentity: 'terminal:term-111111111111111111111',
        selectedIdentity: 'terminal:term-111111111111111111111',
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        terminalSessionId: 'term-111111111111111111111',
        terminalBase: terminalSessionBaseForTest({
          repoRoot: '/example-workspace',
          workspaceRuntimeId: 'workspace-runtime-test',
          branch: null,
          worktreePath: '/example-workspace',
        }),
        processName: 'node',
        presentationEffects,
      })
    })

    expect(terminalActionDialogsStore.getState().closeConfirm).toBeNull()
    expect(dialogProps.latest.open).toBe(false)
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
  })
})

function renderMessageText(message: unknown): string {
  const { container, unmount } = renderInJsdom(<>{message as VNodeChild}</>)
  const text = container.textContent ?? ''
  unmount()
  return text
}
