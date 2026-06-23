import type { TerminalAttachmentRole, TerminalController, TerminalResolvedOwnership } from '#/shared/terminal-types.ts'

export function resolveTerminalAttachmentRole(
  controller: TerminalController | null,
  attachmentId: string,
): TerminalAttachmentRole {
  if (!controller) return 'unowned'
  return controller.attachmentId === attachmentId ? 'controller' : 'viewer'
}

export function resolveTerminalOwnership(
  controller: TerminalController | null,
  attachmentId: string,
): TerminalResolvedOwnership {
  // `controller.status` is always `'connected'` when the slot is set
  // (the server clears the slot on disconnect). Keeping the
  // resolver's contract identical for the `'none'` case lets the
  // caller treat every controller presence the same way.
  return {
    role: resolveTerminalAttachmentRole(controller, attachmentId),
    controllerStatus: controller?.status ?? 'none',
  }
}

export function cloneTerminalController(controller: TerminalController | null): TerminalController | null {
  return controller ? { ...controller } : null
}
