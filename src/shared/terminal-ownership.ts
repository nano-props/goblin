import type {
  TerminalAttachmentRole,
  TerminalController,
  TerminalResolvedOwnership,
} from '#/shared/terminal-types.ts'

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
  return {
    role: resolveTerminalAttachmentRole(controller, attachmentId),
    controllerStatus: controller?.status ?? 'none',
  }
}

export function cloneTerminalController(controller: TerminalController | null): TerminalController | null {
  return controller ? { ...controller } : null
}
