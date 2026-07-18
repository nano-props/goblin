// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalActionDialogHost } from '#/web/components/TerminalActionDialogHost.tsx'
import {
  resetTerminalActionDialogsStore,
  useTerminalActionDialogsStore,
} from '#/web/stores/repos/terminal-action-dialogs.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'

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
        currentRepoId="/repo"
        currentBranchName="main"
        currentWorkspacePaneRoute={{ kind: 'terminal', terminalSessionId: 'term-111111111111111111111' }}
        navigation={{} as PrimaryWindowNavigationActions}
      />,
    )

    act(() => {
      useTerminalActionDialogsStore.getState().openCloseConfirm({
        repoId: '/repo',
        targetIdentity: 'terminal:term-111111111111111111111',
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        terminalSessionId: 'term-111111111111111111111',
        terminalBase: terminalSessionBaseForTest({
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
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
