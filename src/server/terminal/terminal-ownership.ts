import type { TerminalController, TerminalControllerStatus } from '#/shared/terminal.ts'

export interface TerminalAttachmentState {
  cols: number
  rows: number
  connected: boolean
}

export interface TerminalOwnershipState {
  attachments: Map<string, TerminalAttachmentState>
  controller: TerminalController | null
  allowImplicitAttachControl: boolean
  cols: number
  rows: number
}

export interface TerminalOwnershipEffect {
  resizeTo?: { cols: number; rows: number }
  emitOwnership: boolean
}

export function registerTerminalAttachment(
  state: TerminalOwnershipState,
  attachmentId: string,
  cols: number,
  rows: number,
  connected?: boolean,
): void {
  const existing = state.attachments.get(attachmentId)
  state.attachments.set(attachmentId, {
    cols,
    rows,
    connected: connected ?? existing?.connected ?? false,
  })
}

export function attachTerminalAttachment(state: TerminalOwnershipState, attachmentId: string): TerminalOwnershipEffect {
  if (state.controller !== null || !state.allowImplicitAttachControl || !state.attachments.get(attachmentId)?.connected) {
    return { emitOwnership: false }
  }
  return claimTerminalAttachmentControl(state, attachmentId)
}

export function claimTerminalAttachmentControl(
  state: TerminalOwnershipState,
  attachmentId: string,
): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment) return { emitOwnership: false }
  if (!attachment.connected) {
    deleteInactiveTerminalAttachment(state, attachmentId)
    return { emitOwnership: false }
  }
  const sizeChanged = state.cols !== attachment.cols || state.rows !== attachment.rows
  state.controller = { attachmentId, status: 'connected' }
  state.allowImplicitAttachControl = false
  pruneInactiveTerminalAttachments(state)
  return {
    resizeTo: sizeChanged ? { cols: attachment.cols, rows: attachment.rows } : undefined,
    emitOwnership: !sizeChanged,
  }
}

export function restartTerminalAttachmentControl(state: TerminalOwnershipState, attachmentId: string): void {
  state.controller = state.attachments.get(attachmentId)?.connected ? { attachmentId, status: 'connected' } : null
  if (state.controller) state.allowImplicitAttachControl = false
}

export function updateTerminalAttachmentConnection(
  state: TerminalOwnershipState,
  attachmentId: string,
  connected: boolean,
): TerminalOwnershipEffect {
  const attachment = state.attachments.get(attachmentId)
  if (!attachment) return { emitOwnership: false }
  const controllerStatus = connected ? 'connected' : 'grace'
  if (
    attachment.connected === connected &&
    (state.controller?.attachmentId !== attachmentId || state.controller?.status === controllerStatus)
  ) {
    return { emitOwnership: false }
  }
  attachment.connected = connected
  if (state.controller?.attachmentId !== attachmentId) {
    if (connected && state.controller === null && state.allowImplicitAttachControl) {
      return claimTerminalAttachmentControl(state, attachmentId)
    }
    if (!connected) deleteInactiveTerminalAttachment(state, attachmentId)
    return { emitOwnership: false }
  }
  if (state.controller?.status === controllerStatus) return { emitOwnership: false }
  state.controller = { attachmentId, status: controllerStatus as Exclude<TerminalControllerStatus, 'none'> }
  return { emitOwnership: true }
}

export function releaseTerminalAttachmentControl(state: TerminalOwnershipState, attachmentId: string): boolean {
  if (state.controller?.attachmentId !== attachmentId) return false
  const attachment = state.attachments.get(attachmentId)
  if (attachment?.connected) return false
  state.controller = null
  state.allowImplicitAttachControl = false
  state.attachments.delete(attachmentId)
  pruneInactiveTerminalAttachments(state)
  return true
}

export function deleteInactiveTerminalAttachment(state: TerminalOwnershipState, attachmentId: string): void {
  if (state.controller?.attachmentId === attachmentId) return
  const attachment = state.attachments.get(attachmentId)
  if (!attachment || attachment.connected) return
  state.attachments.delete(attachmentId)
}

export function pruneInactiveTerminalAttachments(state: TerminalOwnershipState): void {
  for (const [attachmentId, attachment] of state.attachments.entries()) {
    if (attachment.connected) continue
    if (state.controller?.attachmentId === attachmentId) continue
    state.attachments.delete(attachmentId)
  }
}
