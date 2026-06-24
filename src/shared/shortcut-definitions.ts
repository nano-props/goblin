import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { DictKey } from '#/shared/i18n/dictionaries.ts'

export type BranchActionShortcutAction = 'pull' | 'push' | 'terminal' | 'editor' | 'remote'
export type RendererNavigationShortcutAction =
  | 'next-branch'
  | 'prev-branch'
  | 'next-workspace-pane-view'
  | 'prev-workspace-pane-view'
export type RendererAppShortcutAction = 'show-help' | 'dismiss'
export type RendererKeyboardShortcutAction =
  | BranchActionShortcutAction
  | RendererNavigationShortcutAction
  | RendererAppShortcutAction
export type RendererMenuCommandId =
  | 'app-settings'
  | 'file-new-terminal-tab'
  | 'file-open-local-repo'
  | 'file-open-local-repo-path'
  | 'file-clone-repo'
  | 'file-open-remote-repo'
  | 'file-close-workspace-tab-or-window'
  | 'file-close-tab'
  | 'file-settings'
  | 'view-status'
  | 'view-history'
  | 'view-changes'
  | 'view-terminal'
  | 'view-toggle-focus-mode'
  | 'view-refresh'
  | 'window-next-repo'
  | 'window-prev-repo'
  | 'window-reset-layout'
  | 'help-shortcuts'

export interface KeyboardShortcutMatch {
  key?: string
  code?: string
  shiftKey?: boolean
}

export interface HelpShortcutDefinition {
  combos: string[][]
  labelKey: DictKey
}

export interface AcceleratorShortcutDefinition {
  accelerator: string
  labelKey: DictKey
  labelParams?: Record<string, string | number>
}

export interface RendererMenuCommandContext {}

export interface RendererMenuCommandDefinition {
  id: RendererMenuCommandId
  menuLabelKey: DictKey
  helpLabelKey?: DictKey
  accelerator?: string | ((context: RendererMenuCommandContext) => string | undefined)
  enabled?: (context: RendererMenuCommandContext) => boolean
  intent: ClientEffectIntent | ((context: RendererMenuCommandContext) => ClientEffectIntent)
}

export interface BranchActionShortcutDefinition {
  matches: KeyboardShortcutMatch[]
  action: BranchActionShortcutAction
  combos: string[][]
  labelKey: DictKey
}

export interface RendererKeyboardShortcutDefinition<
  Action extends RendererKeyboardShortcutAction = RendererKeyboardShortcutAction,
> {
  matches: KeyboardShortcutMatch[]
  action: Action
  combos: string[][]
  labelKey: DictKey
}

export const RENDERER_NAVIGATION_SHORTCUTS: RendererKeyboardShortcutDefinition<RendererNavigationShortcutAction>[] = [
  keyboardShortcut([{ key: 'j' }, { key: 'ArrowDown' }], 'next-branch', [['j'], ['↓']], 'help.row.next-branch'),
  keyboardShortcut([{ key: 'k' }, { key: 'ArrowUp' }], 'prev-branch', [['k'], ['↑']], 'help.row.prev-branch'),
  keyboardShortcut([{ key: 'ArrowRight' }], 'next-workspace-pane-view', [['→']], 'help.row.switch-workspace-pane-view'),
  keyboardShortcut([{ key: 'ArrowLeft' }], 'prev-workspace-pane-view', [['←']], 'help.row.switch-workspace-pane-view'),
]

export const BRANCH_ACTION_SHORTCUTS: BranchActionShortcutDefinition[] = [
  branchActionShortcut([{ code: 'KeyP', shiftKey: false }], 'pull', [['p']], 'action.pull'),
  branchActionShortcut([{ code: 'KeyP', shiftKey: true }], 'push', [['⇧', 'P']], 'action.push'),
  branchActionShortcut([{ code: 'KeyG', shiftKey: false }], 'terminal', [['g']], 'worktrees.open-in-terminal-label'),
  branchActionShortcut([{ code: 'KeyV', shiftKey: false }], 'editor', [['v']], 'worktrees.open-in-editor-label'),
  branchActionShortcut([{ code: 'KeyG', shiftKey: true }], 'remote', [['⇧', 'G']], 'action.remote'),
]

export const RENDERER_APP_SHORTCUTS: RendererKeyboardShortcutDefinition<RendererAppShortcutAction>[] = [
  keyboardShortcut([{ key: '?' }], 'show-help', [['?']], 'help.row.this-help'),
  keyboardShortcut([{ key: 'Escape' }], 'dismiss', [['Esc']], 'help.row.dismiss'),
]

export const SETTINGS_SHORTCUT_MAC = 'Cmd+,'
export const SETTINGS_SHORTCUT_NON_MAC = 'Ctrl+,'
export const NEW_TERMINAL_TAB_SHORTCUT = 'CmdOrCtrl+N'
export const CLOSE_WORKSPACE_TAB_OR_WINDOW_SHORTCUT = 'CmdOrCtrl+W'
export const CLOSE_REPO_SHORTCUT = 'CmdOrCtrl+Shift+W'

export const RENDERER_MENU_COMMANDS: RendererMenuCommandDefinition[] = [
  rendererMenuCommand(
    'app-settings',
    'menu.app.settings',
    { type: 'open-settings-requested', page: 'general' },
    {
      helpLabelKey: 'help.row.settings',
      accelerator: () => SETTINGS_SHORTCUT_MAC,
    },
  ),
  rendererMenuCommand(
    'file-new-terminal-tab',
    'terminal.new',
    { type: 'terminal-new-tab-requested' },
    {
      helpLabelKey: 'help.row.new-terminal',
      accelerator: NEW_TERMINAL_TAB_SHORTCUT,
    },
  ),
  rendererMenuCommand(
    'file-open-local-repo',
    'menu.file.open-local-repo',
    { type: 'open-repo-requested' },
    {
      helpLabelKey: 'help.row.open-local-repo',
      accelerator: 'CmdOrCtrl+O',
    },
  ),
  rendererMenuCommand('file-open-local-repo-path', 'menu.file.open-local-repo-path', {
    type: 'open-repo-path-requested',
  }),
  rendererMenuCommand(
    'file-clone-repo',
    'menu.file.clone-repo',
    { type: 'clone-repo-requested' },
    {
      helpLabelKey: 'help.row.clone-repo',
      accelerator: 'CmdOrCtrl+Shift+O',
    },
  ),
  rendererMenuCommand(
    'file-open-remote-repo',
    'menu.file.open-remote-repo',
    { type: 'open-remote-repo-requested' },
    {
      accelerator: 'CmdOrCtrl+Shift+R',
    },
  ),
  rendererMenuCommand(
    'file-close-workspace-tab-or-window',
    'menu.file.close-workspace-tab-or-window',
    { type: 'workspace-pane-close-tab-or-window-requested' },
    {
      helpLabelKey: 'help.row.close-workspace-tab-or-window',
      accelerator: CLOSE_WORKSPACE_TAB_OR_WINDOW_SHORTCUT,
    },
  ),
  rendererMenuCommand(
    'file-close-tab',
    'menu.file.close-tab',
    { type: 'close-repo-requested' },
    {
      helpLabelKey: 'help.row.close-repo',
      accelerator: CLOSE_REPO_SHORTCUT,
    },
  ),
  rendererMenuCommand(
    'file-settings',
    'menu.file.settings',
    { type: 'open-settings-requested', page: 'general' },
    {
      helpLabelKey: 'help.row.settings',
      accelerator: () => SETTINGS_SHORTCUT_NON_MAC,
    },
  ),
  rendererMenuCommand(
    'view-status',
    'menu.view.status',
    { type: 'show-workspace-pane-view-requested', tab: 'status' },
    {
      helpLabelKey: 'help.row.view-status',
    },
  ),
  rendererMenuCommand(
    'view-history',
    'menu.view.history',
    { type: 'show-workspace-pane-view-requested', tab: 'history' },
    {
      helpLabelKey: 'help.row.view-log',
    },
  ),
  rendererMenuCommand(
    'view-changes',
    'menu.view.changes',
    { type: 'show-workspace-pane-view-requested', tab: 'changes' },
    {
      helpLabelKey: 'help.row.view-changes',
    },
  ),
  rendererMenuCommand(
    'view-terminal',
    'menu.view.terminal',
    { type: 'terminal-primary-action-requested' },
    {
      helpLabelKey: 'help.row.view-terminal',
    },
  ),
  rendererMenuCommand(
    'view-toggle-focus-mode',
    'workspace.focus-toggle-label',
    { type: 'workspace-focus-toggle-requested' },
    {
      helpLabelKey: 'workspace.focus-toggle-label',
      accelerator: 'CmdOrCtrl+B',
    },
  ),
  rendererMenuCommand(
    'view-refresh',
    'menu.view.refresh',
    { type: 'repo-refresh-requested' },
    {
      helpLabelKey: 'help.row.refresh',
      accelerator: 'CmdOrCtrl+U',
    },
  ),
  rendererMenuCommand(
    'window-next-repo',
    'menu.window.next-repo',
    { type: 'cycle-repo-requested', direction: 1 },
    {
      helpLabelKey: 'help.row.next-repo',
      accelerator: 'CmdOrCtrl+]',
    },
  ),
  rendererMenuCommand(
    'window-prev-repo',
    'menu.window.prev-repo',
    { type: 'cycle-repo-requested', direction: -1 },
    {
      helpLabelKey: 'help.row.prev-repo',
      accelerator: 'CmdOrCtrl+[',
    },
  ),
  rendererMenuCommand('window-reset-layout', 'menu.window.reset-window', { type: 'layout-reset-requested' }),
  rendererMenuCommand('help-shortcuts', 'menu.help.shortcuts', { type: 'open-settings-requested', page: 'shortcuts' }),
]

export const APP_SHORTCUTS: AcceleratorShortcutDefinition[] = rendererMenuAcceleratorShortcuts([
  'file-new-terminal-tab',
  'file-open-local-repo',
  'file-clone-repo',
  'view-refresh',
]).concat([{ accelerator: 'CmdOrCtrl+R', labelKey: 'help.row.reload-page' }])

export const WINDOW_REPO_SHORTCUTS: AcceleratorShortcutDefinition[] = rendererMenuAcceleratorShortcuts([
  'window-next-repo',
  'window-prev-repo',
])

export const VIEW_SHORTCUTS: AcceleratorShortcutDefinition[] = rendererMenuAcceleratorShortcuts([
  'view-toggle-focus-mode',
])

export const RENDERER_KEYBOARD_SHORTCUTS: RendererKeyboardShortcutDefinition[] = [
  ...RENDERER_NAVIGATION_SHORTCUTS,
  ...BRANCH_ACTION_SHORTCUTS,
  ...RENDERER_APP_SHORTCUTS,
]

export function matchBranchActionShortcut(input: {
  code: string
  shiftKey: boolean
}): BranchActionShortcutAction | null {
  return matchKeyboardShortcut(BRANCH_ACTION_SHORTCUTS, input)
}

export function matchRendererKeyboardShortcut(input: {
  key: string
  code: string
  shiftKey: boolean
}): RendererKeyboardShortcutAction | null {
  return matchKeyboardShortcut(RENDERER_KEYBOARD_SHORTCUTS, input)
}

export function rendererMenuCommandById(id: RendererMenuCommandId): RendererMenuCommandDefinition {
  const command = RENDERER_MENU_COMMANDS.find((candidate) => candidate.id === id)
  if (!command) throw new Error(`Unknown client menu command: ${id}`)
  return command
}

export function resolveRendererMenuCommandAccelerator(
  command: Pick<RendererMenuCommandDefinition, 'accelerator'>,
  context: RendererMenuCommandContext,
): string | undefined {
  return typeof command.accelerator === 'function' ? command.accelerator(context) : command.accelerator
}

export function resolveRendererMenuCommandIntent(
  command: Pick<RendererMenuCommandDefinition, 'intent'>,
  context: RendererMenuCommandContext,
): ClientEffectIntent {
  return typeof command.intent === 'function' ? command.intent(context) : command.intent
}

export function resolveRendererMenuCommandEnabled(
  command: Pick<RendererMenuCommandDefinition, 'enabled'>,
  context: RendererMenuCommandContext,
): boolean | undefined {
  return command.enabled?.(context)
}

function keyboardShortcut<Action extends RendererKeyboardShortcutAction>(
  matches: KeyboardShortcutMatch[],
  action: Action,
  combos: string[][],
  labelKey: DictKey,
): RendererKeyboardShortcutDefinition<Action> {
  return { matches, action, combos, labelKey }
}

function branchActionShortcut(
  matches: KeyboardShortcutMatch[],
  action: BranchActionShortcutAction,
  combos: string[][],
  labelKey: DictKey,
): BranchActionShortcutDefinition {
  return { matches, action, combos, labelKey }
}

function rendererMenuCommand(
  id: RendererMenuCommandId,
  menuLabelKey: DictKey,
  intent: ClientEffectIntent,
  options: Omit<Partial<RendererMenuCommandDefinition>, 'id' | 'menuLabelKey' | 'intent'> = {},
): RendererMenuCommandDefinition {
  return { id, menuLabelKey, intent, ...options }
}

function matchKeyboardShortcut<Action extends string>(
  shortcuts: readonly { matches: readonly KeyboardShortcutMatch[]; action: Action }[],
  input: { key?: string; code?: string; shiftKey?: boolean },
): Action | null {
  for (const shortcut of shortcuts) {
    if (shortcut.matches.some((match) => keyboardShortcutMatch(match, input))) return shortcut.action
  }
  return null
}

function keyboardShortcutMatch(
  match: KeyboardShortcutMatch,
  input: { key?: string; code?: string; shiftKey?: boolean },
): boolean {
  if (match.key !== undefined && input.key !== match.key) return false
  if (match.code !== undefined && input.code !== match.code) return false
  if (match.shiftKey !== undefined && input.shiftKey !== match.shiftKey) return false
  return true
}

function rendererMenuAcceleratorShortcuts(ids: RendererMenuCommandId[]): AcceleratorShortcutDefinition[] {
  return ids.map((id) => {
    const command = rendererMenuCommandById(id)
    const accelerator = resolveRendererMenuCommandAccelerator(command, {})
    if (!accelerator || !command.helpLabelKey)
      throw new Error(`Client menu command ${id} is missing help shortcut metadata`)
    return { accelerator, labelKey: command.helpLabelKey }
  })
}
