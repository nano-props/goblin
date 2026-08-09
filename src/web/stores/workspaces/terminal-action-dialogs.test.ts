import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import {
  resetTerminalActionDialogsStore,
  terminalActionDialogsStore,
} from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import type { TerminalCloseConfirmPayload } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

const WORKSPACE_A = workspaceIdForTest('goblin+file:///workspace-a')
const WORKSPACE_B = workspaceIdForTest('goblin+file:///workspace-b')

beforeEach(() => {
  resetTerminalActionDialogsStore()
})

afterEach(() => {
  resetTerminalActionDialogsStore()
})

describe('terminalActionDialogsStore close presentation ownership', () => {
  test('abandons a close presentation when the user cancels its confirmation', () => {
    const effects = presentationEffects()
    terminalActionDialogsStore.getState().openCloseConfirm(closeConfirmPayload(WORKSPACE_A, effects))

    terminalActionDialogsStore.getState().closeCloseConfirm()

    expect(terminalActionDialogsStore.getState().closeConfirm).toBeNull()
    expect(effects.onAbandon).toHaveBeenCalledOnce()
    expect(effects.onCommit).not.toHaveBeenCalled()
  })

  test('abandons only the replaced confirmation presentation', () => {
    const previousEffects = presentationEffects()
    const currentEffects = presentationEffects()
    terminalActionDialogsStore.getState().openCloseConfirm(closeConfirmPayload(WORKSPACE_A, previousEffects))

    const currentPayload = closeConfirmPayload(WORKSPACE_A, currentEffects, 'term-222222222222222222222')
    terminalActionDialogsStore.getState().openCloseConfirm(currentPayload)

    expect(previousEffects.onAbandon).toHaveBeenCalledOnce()
    expect(previousEffects.onCommit).not.toHaveBeenCalled()
    expect(currentEffects.onAbandon).not.toHaveBeenCalled()
    expect(terminalActionDialogsStore.getState().closeConfirm).toBe(currentPayload)
  })

  test('abandons a stale workspace confirmation but retains the current workspace confirmation', () => {
    const effects = presentationEffects()
    const payload = closeConfirmPayload(WORKSPACE_A, effects)
    terminalActionDialogsStore.getState().openCloseConfirm(payload)

    terminalActionDialogsStore.getState().closeStaleDialogs(WORKSPACE_A)
    expect(terminalActionDialogsStore.getState().closeConfirm).toBe(payload)
    expect(effects.onAbandon).not.toHaveBeenCalled()

    terminalActionDialogsStore.getState().closeStaleDialogs(WORKSPACE_B)
    expect(terminalActionDialogsStore.getState().closeConfirm).toBeNull()
    expect(effects.onAbandon).toHaveBeenCalledOnce()
    expect(effects.onCommit).not.toHaveBeenCalled()
  })

  test('transfers confirmation ownership without settling its presentation', () => {
    const effects = presentationEffects()
    const payload = closeConfirmPayload(WORKSPACE_A, effects)
    terminalActionDialogsStore.getState().openCloseConfirm(payload)

    const taken = terminalActionDialogsStore.getState().takeCloseConfirm()

    expect(taken).toBe(payload)
    expect(terminalActionDialogsStore.getState().closeConfirm).toBeNull()
    expect(effects.onCommit).not.toHaveBeenCalled()
    expect(effects.onAbandon).not.toHaveBeenCalled()
  })

  test('abandons the owned presentation when the store resets', () => {
    const effects = presentationEffects()
    terminalActionDialogsStore.getState().openCloseConfirm(closeConfirmPayload(WORKSPACE_A, effects))

    resetTerminalActionDialogsStore()

    expect(terminalActionDialogsStore.getState().closeConfirm).toBeNull()
    expect(effects.onAbandon).toHaveBeenCalledOnce()
    expect(effects.onCommit).not.toHaveBeenCalled()
  })
})

function closeConfirmPayload(
  workspaceId: typeof WORKSPACE_A,
  effects: WorkspacePaneTabClosePresentationEffects,
  terminalSessionId = 'term-111111111111111111111',
): TerminalCloseConfirmPayload {
  return {
    workspaceId,
    routeTarget: { kind: 'workspace-root', workspaceId },
    targetIdentity: `terminal:${terminalSessionId}`,
    selectedIdentity: `terminal:${terminalSessionId}`,
    workspacePaneRoute: { kind: 'terminal', terminalSessionId },
    terminalSessionId,
    terminalBase: terminalSessionBaseForTest({
      repoRoot: '/workspace-a',
      workspaceRuntimeId: 'workspace-runtime-a',
      branch: null,
      worktreePath: '/workspace-a',
    }),
    processName: 'node',
    presentationEffects: effects,
  }
}

function presentationEffects() {
  return {
    onCommit: vi.fn(),
    onAbandon: vi.fn(),
  }
}
