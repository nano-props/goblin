import type { TerminalClientRole, TerminalController, TerminalResolvedController } from '#/shared/terminal-types.ts'

export function resolveTerminalClientRole(controller: TerminalController | null, clientId: string): TerminalClientRole {
  if (!controller) return 'unowned'
  return controller.clientId === clientId ? 'controller' : 'viewer'
}

export function resolveTerminalController(
  controller: TerminalController | null,
  clientId: string,
): TerminalResolvedController {
  // `controller.status` is always `'connected'` when an effective
  // controller is projected. Offline controller intent is passed as
  // `null`, keeping the `'none'` case explicit for callers.
  return {
    role: resolveTerminalClientRole(controller, clientId),
    controllerStatus: controller?.status ?? 'none',
  }
}

export function cloneTerminalController(controller: TerminalController | null): TerminalController | null {
  return controller ? { ...controller } : null
}
