import type { ComponentType } from 'react'
import type { EditorAppAvailability, EditorApp, TerminalApp, TerminalAppAvailability } from '#/shared/api-types.ts'
import type { WorkspaceExternalAppId } from '#/shared/workspace-settings.ts'
import { AppleTerminalIcon, FinderIcon, GhosttyIcon, VSCodeIcon } from '#/web/components/ExternalAppIcon/index.tsx'

export type WorkspaceExternalTerminalApp = Extract<TerminalApp, 'ghostty' | 'terminal'>
export type WorkspaceExternalEditorApp = EditorApp

interface WorkspaceExternalAppBase<TKind extends 'terminal' | 'editor' | 'finder'> {
  kind: TKind
  id: string
  labelKey: string
  Icon: ComponentType<{ className?: string }>
  supportsRemote: boolean
}

export interface WorkspaceExternalTerminalAppItem extends WorkspaceExternalAppBase<'terminal'> {
  app: WorkspaceExternalTerminalApp
}

export interface WorkspaceExternalEditorAppItem extends WorkspaceExternalAppBase<'editor'> {
  app: WorkspaceExternalEditorApp
}

export type WorkspaceExternalFinderItem = WorkspaceExternalAppBase<'finder'>
export type WorkspaceExternalAppItem =
  WorkspaceExternalTerminalAppItem | WorkspaceExternalEditorAppItem | WorkspaceExternalFinderItem

export const WORKSPACE_EXTERNAL_TERMINAL_APPS = [
  {
    kind: 'terminal',
    app: 'ghostty',
    id: 'terminal:ghostty',
    labelKey: 'settings.terminal.ghostty',
    Icon: GhosttyIcon,
    supportsRemote: true,
  },
  {
    kind: 'terminal',
    app: 'terminal',
    id: 'terminal:terminal',
    labelKey: 'settings.terminal.terminal',
    Icon: AppleTerminalIcon,
    supportsRemote: true,
  },
] as const satisfies readonly WorkspaceExternalTerminalAppItem[]

export const WORKSPACE_EXTERNAL_EDITOR_APPS = [
  {
    kind: 'editor',
    app: 'vscode',
    id: 'editor:vscode',
    labelKey: 'settings.editor.vscode',
    Icon: VSCodeIcon,
    supportsRemote: true,
  },
] as const satisfies readonly WorkspaceExternalEditorAppItem[]

export const WORKSPACE_EXTERNAL_FINDER_APPS = [
  {
    kind: 'finder',
    id: 'finder',
    labelKey: 'worktrees.reveal-title',
    Icon: FinderIcon,
    supportsRemote: false,
  },
] as const satisfies readonly WorkspaceExternalFinderItem[]

export const WORKSPACE_EXTERNAL_APPS = [
  ...WORKSPACE_EXTERNAL_TERMINAL_APPS,
  ...WORKSPACE_EXTERNAL_EDITOR_APPS,
  ...WORKSPACE_EXTERNAL_FINDER_APPS,
] as const satisfies readonly WorkspaceExternalAppItem[]

// Compile-time guard: every item id in WORKSPACE_EXTERNAL_APPS must
// be a member of the shared `WorkspaceExternalAppId` union, otherwise
// the server-side normalizer would reject the value as unknown. This
// is a two-way check — both `RegisteredIds extends
// WorkspaceExternalAppId` (catches an id in the web array that isn't
// in the shared set) and `WorkspaceExternalAppId extends
// RegisteredIds` (catches a shared set entry that has no matching
// web item, which would be a dead id the user can never pick).
//
// Adding a new editor (e.g. WebStorm as `'editor:webstorm'`) requires
// updating BOTH sides — the guard will fail to typecheck if either
// side is missed. See the full checklist in `src/system/editors.ts`.
type RegisteredIds = (typeof WORKSPACE_EXTERNAL_APPS)[number]['id']
type AssertAllRegisteredIdsAreKnown = RegisteredIds extends WorkspaceExternalAppId
  ? WorkspaceExternalAppId extends RegisteredIds
    ? true
    : false
  : false
const allRegisteredIdsKnown: AssertAllRegisteredIdsAreKnown = true
void allRegisteredIdsKnown

export function workspaceExternalAppAvailable(
  item: WorkspaceExternalAppItem,
  availability: {
    terminals: TerminalAppAvailability
    editors: EditorAppAvailability
    finder: boolean
  },
): boolean {
  if (item.kind === 'finder') return availability.finder
  return item.kind === 'terminal' ? availability.terminals[item.app] : availability.editors[item.app]
}
