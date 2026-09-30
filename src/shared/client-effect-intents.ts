import { isWorkspacePaneTabType, type WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { isValidTerminalSessionBase } from '#/shared/terminal-validators.ts'

type TerminalBellClickIntent = {
  type: 'terminal-bell-click'
  terminalSessionId: string
  session: TerminalSessionBase
}

export type RepoViewClientIntent = { type: 'show-workspace-pane-tab-requested'; tab: WorkspacePaneTabType }

export type ClientEffectIntent = RepoViewClientIntent | TerminalBellClickIntent

export type ClientEffectIntentType = ClientEffectIntent['type']

export function isClientEffectIntent(event: unknown): event is ClientEffectIntent {
  if (!isRecord(event)) return false
  switch (event.type) {
    case 'show-workspace-pane-tab-requested':
      return isWorkspacePaneTabType(typeof event.tab === 'string' ? event.tab : null)
    case 'terminal-bell-click':
      return typeof event.terminalSessionId === 'string' && isValidTerminalSessionBase(event.session)
    default:
      return false
  }
}

export function isRepoViewClientIntent(event: unknown): event is RepoViewClientIntent {
  return isClientEffectIntent(event) && event.type === 'show-workspace-pane-tab-requested'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}
