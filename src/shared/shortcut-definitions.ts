import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import type { DictKey } from '#/shared/i18n/dictionaries.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'

export type BranchActionShortcutAction = 'pull' | 'push' | 'terminal' | 'editor' | 'remote'
export type RendererNavigationShortcutAction = 'next-branch' | 'prev-branch' | 'next-detail-tab' | 'prev-detail-tab'
export type RendererAppShortcutAction = 'checkout-selected' | 'show-help' | 'dismiss'
export type RendererKeyboardShortcutAction =
  | BranchActionShortcutAction
  | RendererNavigationShortcutAction
  | RendererAppShortcutAction
export type RendererMenuCommandId =
  | 'app-settings'
  | 'file-open-local-repo'
  | 'file-open-local-repo-path'
  | 'file-clone-repo'
  | 'file-open-remote-repo'
  | 'file-close-tab'
  | 'file-settings'
  | 'view-status'
  | 'view-changes'
  | 'view-terminal'
  | 'view-terminal-primary-action'
  | 'view-toggle-detail'
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

export interface IndexedTerminalShortcutDefinition extends AcceleratorShortcutDefinition {
  index: number
}

export interface RendererMenuCommandContext {
  swapCloseShortcuts: boolean
  workspaceLayout: WorkspaceLayout
}

export interface RendererMenuCommandDefinition {
  id: RendererMenuCommandId
  menuLabelKey: DictKey
  helpLabelKey?: DictKey
  accelerator?: string | ((context: RendererMenuCommandContext) => string | undefined)
  enabled?: (context: RendererMenuCommandContext) => boolean
  intent: RendererEffectIntent | ((context: RendererMenuCommandContext) => RendererEffectIntent)
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
  keyboardShortcut([{ key: 'ArrowRight' }], 'next-detail-tab', [['→']], 'help.row.switch-detail-tab'),
  keyboardShortcut([{ key: 'ArrowLeft' }], 'prev-detail-tab', [['←']], 'help.row.switch-detail-tab'),
]

export const BRANCH_ACTION_SHORTCUTS: BranchActionShortcutDefinition[] = [
  branchActionShortcut([{ code: 'KeyP', shiftKey: false }], 'pull', [['p']], 'action.pull'),
  branchActionShortcut([{ code: 'KeyP', shiftKey: true }], 'push', [['⇧', 'P']], 'action.push'),
  branchActionShortcut([{ code: 'KeyG', shiftKey: false }], 'terminal', [['g']], 'worktrees.open-in-terminal-label'),
  branchActionShortcut([{ code: 'KeyV', shiftKey: false }], 'editor', [['v']], 'worktrees.open-in-editor-label'),
  branchActionShortcut([{ code: 'KeyG', shiftKey: true }], 'remote', [['⇧', 'G']], 'action.remote'),
]

export const RENDERER_APP_SHORTCUTS: RendererKeyboardShortcutDefinition<RendererAppShortcutAction>[] = [
  keyboardShortcut([{ key: 'Enter' }], 'checkout-selected', [['Enter']], 'help.row.checkout'),
  keyboardShortcut([{ key: '?' }], 'show-help', [['?']], 'help.row.this-help'),
  keyboardShortcut([{ key: 'Escape' }], 'dismiss', [['Esc']], 'help.row.dismiss'),
]

export const SETTINGS_SHORTCUT_MAC = 'Cmd+,'
export const SETTINGS_SHORTCUT_NON_MAC = 'Ctrl+,'
export const CLOSE_TAB_SHORTCUT_DEFAULT = 'CmdOrCtrl+Shift+W'
export const CLOSE_TAB_SHORTCUT_SWAPPED = 'CmdOrCtrl+W'
export const CLOSE_WINDOW_SHORTCUT_DEFAULT = 'CmdOrCtrl+W'
export const CLOSE_WINDOW_SHORTCUT_SWAPPED = 'CmdOrCtrl+Shift+W'

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
    'file-close-tab',
    'menu.file.close-tab',
    { type: 'close-repo-requested' },
    {
      helpLabelKey: 'help.row.close-repo',
      accelerator: (context) => closeShortcutAccelerators(context.swapCloseShortcuts).closeTab,
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
    { type: 'show-detail-tab-requested', tab: 'status' },
    {
      helpLabelKey: 'help.row.view-status',
      accelerator: 'CmdOrCtrl+1',
    },
  ),
  rendererMenuCommand(
    'view-changes',
    'menu.view.changes',
    { type: 'show-detail-tab-requested', tab: 'changes' },
    {
      helpLabelKey: 'help.row.view-changes',
      accelerator: 'CmdOrCtrl+2',
    },
  ),
  rendererMenuCommand(
    'view-terminal',
    'menu.view.terminal',
    { type: 'show-detail-tab-requested', tab: 'terminal' },
    {
      helpLabelKey: 'help.row.view-terminal',
    },
  ),
  rendererMenuCommand(
    'view-terminal-primary-action',
    'menu.view.terminal-primary-action',
    { type: 'terminal-primary-action-requested' },
    {
      helpLabelKey: 'help.row.terminal-primary-action',
      accelerator: 'CmdOrCtrl+Enter',
    },
  ),
  rendererMenuCommand(
    'view-toggle-detail',
    'menu.view.toggle-detail',
    { type: 'toggle-detail-requested' },
    {
      helpLabelKey: 'help.row.toggle-detail',
      accelerator: 'CmdOrCtrl+J',
      enabled: (context) => context.workspaceLayout === 'top-bottom',
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
  rendererMenuCommand('window-reset-layout', 'menu.window.reset-layout', { type: 'workspace-layout-reset-requested' }),
  rendererMenuCommand('help-shortcuts', 'menu.help.shortcuts', { type: 'open-settings-requested', page: 'shortcuts' }),
]

export const APP_SHORTCUTS: AcceleratorShortcutDefinition[] = rendererMenuAcceleratorShortcuts([
  'file-open-local-repo',
  'file-clone-repo',
  'view-refresh',
]).concat([{ accelerator: 'CmdOrCtrl+R', labelKey: 'help.row.reload-page' }])

export const WINDOW_REPO_SHORTCUTS: AcceleratorShortcutDefinition[] = rendererMenuAcceleratorShortcuts([
  'window-next-repo',
  'window-prev-repo',
])

export const VIEW_SHORTCUTS: AcceleratorShortcutDefinition[] = rendererMenuAcceleratorShortcuts([
  'view-status',
  'view-changes',
  'view-terminal-primary-action',
  'view-toggle-detail',
]).concat(terminalSelectionShortcuts())

export const TERMINAL_SELECTION_SHORTCUTS: IndexedTerminalShortcutDefinition[] = terminalSelectionShortcuts()

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

export function closeShortcutAccelerators(swapCloseShortcuts = false): {
  closeTab: string
  closeWindow: string
} {
  return swapCloseShortcuts
    ? { closeTab: CLOSE_TAB_SHORTCUT_SWAPPED, closeWindow: CLOSE_WINDOW_SHORTCUT_SWAPPED }
    : { closeTab: CLOSE_TAB_SHORTCUT_DEFAULT, closeWindow: CLOSE_WINDOW_SHORTCUT_DEFAULT }
}

export function rendererMenuCommandById(id: RendererMenuCommandId): RendererMenuCommandDefinition {
  const command = RENDERER_MENU_COMMANDS.find((candidate) => candidate.id === id)
  if (!command) throw new Error(`Unknown renderer menu command: ${id}`)
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
): RendererEffectIntent {
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
  intent: RendererEffectIntent,
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
    const accelerator = resolveRendererMenuCommandAccelerator(command, {
      swapCloseShortcuts: false,
      workspaceLayout: 'top-bottom',
    })
    if (!accelerator || !command.helpLabelKey)
      throw new Error(`Renderer menu command ${id} is missing help shortcut metadata`)
    return { accelerator, labelKey: command.helpLabelKey }
  })
}

function terminalSelectionShortcuts(): IndexedTerminalShortcutDefinition[] {
  return Array.from({ length: 7 }, (_, index) => ({
    index: index + 1,
    accelerator: `CmdOrCtrl+${index + 3}`,
    labelKey: 'help.row.view-terminal-numbered',
    labelParams: { index: index + 1 },
  }))
}
