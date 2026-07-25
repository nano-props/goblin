// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { TerminalActionDialogHost } from '#/web/components/TerminalActionDialogHost.tsx'
import {
  resetTerminalActionDialogsStore,
  useTerminalActionDialogsStore,
} from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import { primaryWindowNavigationActionsForTest } from '#/web/test-utils/primary-window-navigation.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')

const dialogProps = vi.hoisted(() => ({
  latest: { open: false, title: '', message: null as unknown },
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    void params
    if (key === 'terminal.confirm-close-running-body') return 'process:'
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
  resetTerminalActionDialogsStore()
  dialogProps.latest = { open: false, title: '', message: null }
})

afterEach(() => {
  resetTerminalActionDialogsStore()
  cleanup()
})

describe('TerminalActionDialogHost', () => {
  test('retains the process message while the close animation runs after store state is cleared', () => {
    renderInJsdom(
      <TerminalActionDialogHost
        currentWorkspaceId={WORKSPACE_ID}
        currentWorkspacePaneRoute={{ kind: 'terminal', terminalSessionId: 'term-111111111111111111111' }}
        navigation={primaryWindowNavigationActionsForTest()}
      />,
    )

    act(() => {
      useTerminalActionDialogsStore.getState().openCloseConfirm({
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

    act(() => {
      useTerminalActionDialogsStore.getState().closeCloseConfirm()
    })

    expect(dialogProps.latest).toMatchObject({
      open: false,
    })
    expect(renderMessageText(dialogProps.latest.message)).toContain('process:')
    expect(renderMessageText(dialogProps.latest.message)).toContain('node')
  })
})

function renderMessageText(message: unknown): string {
  const { container, unmount } = renderInJsdom(<>{message as React.ReactNode}</>)
  const text = container.textContent ?? ''
  unmount()
  return text
}
