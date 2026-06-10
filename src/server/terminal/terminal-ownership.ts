import type { TerminalController, TerminalControllerStatus } from '#/shared/terminal.ts'

export interface TerminalAttachmentState {
  cols: number
  rows: number
  connected: boolean
}

export interface TerminalOwnershipState {
  attachmentId: string | null
  attachment: TerminalAttachmentState | null
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
  state.attachmentId = attachmentId
  state.attachment = {
    cols,
    rows,
    connected: connected ?? state.attachment?.connected ?? false,
  }
}

export function attachTerminalAttachment(state: TerminalOwnershipState, attachmentId: string): TerminalOwnershipEffect {
  if (
    state.controller !== null ||
    !state.allowImplicitAttachControl ||
    state.attachmentId !== attachmentId ||
    !state.attachment?.connected
  ) {
    return { emitOwnership: false }
  }
  return claimTerminalAttachmentControl(state, attachmentId)
}

export function claimTerminalAttachmentControl(
  state: TerminalOwnershipState,
  attachmentId: string,
): TerminalOwnershipEffect {
  if (state.attachmentId !== attachmentId || !state.attachment) return { emitOwnership: false }
  if (!state.attachment.connected) {
    state.attachment = null
    state.attachmentId = null
    return { emitOwnership: false }
  }
  const sizeChanged = state.cols !== state.attachment.cols || state.rows !== state.attachment.rows
  state.controller = { attachmentId, status: 'connected' }
  state.allowImplicitAttachControl = false
  return {
    resizeTo: sizeChanged ? { cols: state.attachment.cols, rows: state.attachment.rows } : undefined,
    emitOwnership: !sizeChanged,
  }
}

export function restartTerminalAttachmentControl(state: TerminalOwnershipState, attachmentId: string): void {
  state.controller =
    state.attachmentId === attachmentId && state.attachment?.connected
      ? { attachmentId, status: 'connected' }
      : null
  if (state.controller) state.allowImplicitAttachControl = false
}

export function updateTerminalAttachmentConnection(
  state: TerminalOwnershipState,
  attachmentId: string,
  connected: boolean,
): TerminalOwnershipEffect {
  if (state.attachmentId !== attachmentId || !state.attachment) return { emitOwnership: false }
  const controllerStatus = connected ? 'connected' : 'grace'
  if (
    state.attachment.connected === connected &&
    (state.controller?.attachmentId !== attachmentId || state.controller?.status === controllerStatus)
  ) {
    return { emitOwnership: false }
  }
  state.attachment.connected = connected
  if (state.controller?.attachmentId !== attachmentId) {
    if (connected && state.controller === null && state.allowImplicitAttachControl) {
      return claimTerminalAttachmentControl(state, attachmentId)
    }
    if (!connected) {
      state.attachment = null
      state.attachmentId = null
    }
    return { emitOwnership: false }
  }
  if (state.controller?.status === controllerStatus) return { emitOwnership: false }
  state.controller = { attachmentId, status: controllerStatus as Exclude<TerminalControllerStatus, 'none'> }
  return { emitOwnership: true }
}

export function releaseTerminalAttachmentControl(state: TerminalOwnershipState, attachmentId: string): boolean {
  if (state.controller?.attachmentId !== attachmentId) return false
  if (state.attachment?.connected) return false
  state.controller = null
  state.allowImplicitAttachControl = false
  state.attachment = null
  state.attachmentId = null
  return true
}
