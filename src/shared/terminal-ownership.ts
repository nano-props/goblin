import type { TerminalClientRole, TerminalController, TerminalResolvedOwnership } from '#/shared/terminal-types.ts'

export function resolveTerminalClientRole(
  controller: TerminalController | null,
  clientId: string,
): TerminalClientRole {
  if (!controller) return 'unowned'
  return controller.clientId === clientId ? 'controller' : 'viewer'
}

export function resolveTerminalOwnership(
  controller: TerminalController | null,
  clientId: string,
): TerminalResolvedOwnership {
  // `controller.status` is always `'connected'` when the slot is set
  // (the server clears the slot on disconnect). Keeping the
  // resolver's contract identical for the `'none'` case lets the
  // caller treat every controller presence the same way.
  return {
    role: resolveTerminalClientRole(controller, clientId),
    controllerStatus: controller?.status ?? 'none',
  }
}

export function cloneTerminalController(controller: TerminalController | null): TerminalController | null {
  return controller ? { ...controller } : null
}
