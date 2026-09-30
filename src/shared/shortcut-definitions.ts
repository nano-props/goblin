import type { DictKey } from '#/shared/i18n/en.ts'

export type BranchActionShortcutAction = 'pull' | 'push'
export type ClientNavigationShortcutAction =
  'next-branch' | 'prev-branch' | 'next-workspace-pane-tab' | 'prev-workspace-pane-tab'
export type ClientAppShortcutAction = 'show-help' | 'dismiss'
export type ClientKeyboardShortcutAction =
  BranchActionShortcutAction | ClientNavigationShortcutAction | ClientAppShortcutAction
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

export interface BranchActionShortcutDefinition {
  matches: KeyboardShortcutMatch[]
  action: BranchActionShortcutAction
  combos: string[][]
  labelKey: DictKey
}

export interface ClientKeyboardShortcutDefinition<
  Action extends ClientKeyboardShortcutAction = ClientKeyboardShortcutAction,
> {
  matches: KeyboardShortcutMatch[]
  action: Action
  combos: string[][]
  labelKey: DictKey
}

export const CLIENT_NAVIGATION_SHORTCUTS: ClientKeyboardShortcutDefinition<ClientNavigationShortcutAction>[] = [
  keyboardShortcut([{ key: 'j' }, { key: 'ArrowDown' }], 'next-branch', [['j'], ['↓']], 'help.row.next-branch'),
  keyboardShortcut([{ key: 'k' }, { key: 'ArrowUp' }], 'prev-branch', [['k'], ['↑']], 'help.row.prev-branch'),
  keyboardShortcut([{ key: 'ArrowRight' }], 'next-workspace-pane-tab', [['→']], 'help.row.switch-workspace-pane-tab'),
  keyboardShortcut([{ key: 'ArrowLeft' }], 'prev-workspace-pane-tab', [['←']], 'help.row.switch-workspace-pane-tab'),
]

export const BRANCH_ACTION_SHORTCUTS: BranchActionShortcutDefinition[] = [
  branchActionShortcut([{ code: 'KeyP', shiftKey: false }], 'pull', [['P']], 'action.pull'),
  branchActionShortcut([{ code: 'KeyP', shiftKey: true }], 'push', [['⇧', 'P']], 'action.push'),
]

export const CLIENT_APP_SHORTCUTS: ClientKeyboardShortcutDefinition<ClientAppShortcutAction>[] = [
  keyboardShortcut([{ key: '?' }], 'show-help', [['?']], 'help.row.this-help'),
  keyboardShortcut([{ key: 'Escape' }], 'dismiss', [['Esc']], 'help.row.dismiss'),
]

export const NEW_TERMINAL_TAB_SHORTCUT = 'CmdOrCtrl+T'
export const CREATE_WORKTREE_SHORTCUT = 'CmdOrCtrl+N'
export const CLOSE_WORKSPACE_TAB_SHORTCUT = 'CmdOrCtrl+W'

export const APP_SHORTCUTS: AcceleratorShortcutDefinition[] = [
  { accelerator: NEW_TERMINAL_TAB_SHORTCUT, labelKey: 'help.row.new-terminal' },
  { accelerator: CREATE_WORKTREE_SHORTCUT, labelKey: 'help.row.create-worktree' },
  { accelerator: CLOSE_WORKSPACE_TAB_SHORTCUT, labelKey: 'help.row.close-workspace-tab' },
  { accelerator: 'CmdOrCtrl+R', labelKey: 'help.row.reload-page' },
]

export const CLIENT_KEYBOARD_SHORTCUTS: ClientKeyboardShortcutDefinition[] = [
  ...CLIENT_NAVIGATION_SHORTCUTS,
  ...BRANCH_ACTION_SHORTCUTS,
  ...CLIENT_APP_SHORTCUTS,
]

export function matchBranchActionShortcut(input: {
  code: string
  shiftKey: boolean
}): BranchActionShortcutAction | null {
  return matchKeyboardShortcut(BRANCH_ACTION_SHORTCUTS, input)
}

export function matchClientKeyboardShortcut(input: {
  key: string
  code: string
  shiftKey: boolean
}): ClientKeyboardShortcutAction | null {
  return matchKeyboardShortcut(CLIENT_KEYBOARD_SHORTCUTS, input)
}

function keyboardShortcut<Action extends ClientKeyboardShortcutAction>(
  matches: KeyboardShortcutMatch[],
  action: Action,
  combos: string[][],
  labelKey: DictKey,
): ClientKeyboardShortcutDefinition<Action> {
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
