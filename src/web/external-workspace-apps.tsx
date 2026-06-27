import type { ComponentType } from 'react'
import type { EditorAppAvailability, EditorApp, TerminalApp, TerminalAppAvailability } from '#/shared/api-types.ts'
import {
  AppleTerminalIcon,
  CursorIcon,
  FinderIcon,
  GhosttyIcon,
  VSCodeIcon,
  WindsurfIcon,
} from '#/web/components/ExternalAppIcon/index.tsx'

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
  | WorkspaceExternalTerminalAppItem
  | WorkspaceExternalEditorAppItem
  | WorkspaceExternalFinderItem

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
  {
    kind: 'editor',
    app: 'cursor',
    id: 'editor:cursor',
    labelKey: 'settings.editor.cursor',
    Icon: CursorIcon,
    supportsRemote: true,
  },
  {
    kind: 'editor',
    app: 'windsurf',
    id: 'editor:windsurf',
    labelKey: 'settings.editor.windsurf',
    Icon: WindsurfIcon,
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
