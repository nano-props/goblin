import { acceleratorToKeyLabels } from '#/shared/accelerator.ts'
import type { DictKey } from '#/shared/i18n/dictionaries.ts'
import {
  APP_SHORTCUTS,
  BRANCH_ACTION_SHORTCUTS,
  CLIENT_APP_SHORTCUTS,
  CLIENT_NAVIGATION_SHORTCUTS,
  SETTINGS_SHORTCUT_MAC,
  SETTINGS_SHORTCUT_NON_MAC,
  VIEW_SHORTCUTS,
  WINDOW_REPO_SHORTCUTS,
  CLOSE_WORKSPACE_SHORTCUT,
  CLOSE_WORKSPACE_TAB_OR_WINDOW_SHORTCUT,
} from '#/shared/shortcut-definitions.ts'
export interface HelpShortcutRow {
  combos: string[][]
  labelKey: DictKey
  labelParams?: Record<string, string | number>
}

export interface HelpShortcutSection {
  titleKey: DictKey
  rows: HelpShortcutRow[]
}

export function helpShortcutSections(globalShortcut: string, isMac = inferIsMacPlatform()): HelpShortcutSection[] {
  return [
    {
      titleKey: 'help.section.nav',
      rows: [
        ...CLIENT_NAVIGATION_SHORTCUTS.map(helpRowFromKeyboardDefinition),
        ...WINDOW_REPO_SHORTCUTS.map((shortcut) => helpRowFromAccelerator(shortcut, isMac)),
      ],
    },
    {
      titleKey: 'help.section.branch-actions',
      rows: BRANCH_ACTION_SHORTCUTS.map(helpRowFromKeyboardDefinition),
    },
    {
      titleKey: 'help.section.views',
      rows: [
        workspaceTabShortcutRow(isMac),
        ...VIEW_SHORTCUTS.map((shortcut) => helpRowFromAccelerator(shortcut, isMac)),
      ],
    },
    {
      titleKey: 'help.section.app',
      rows: [
        ...APP_SHORTCUTS.map((shortcut) => helpRowFromAccelerator(shortcut, isMac)),
        { combos: [acceleratorToKeyLabels(globalShortcut)], labelKey: 'help.row.activate-window' },
        {
          combos: [acceleratorToKeyLabelsForHelp(CLOSE_WORKSPACE_TAB_OR_WINDOW_SHORTCUT, isMac)],
          labelKey: 'help.row.close-workspace-tab-or-window',
        },
        {
          combos: [acceleratorToKeyLabelsForHelp(CLOSE_WORKSPACE_SHORTCUT, isMac)],
          labelKey: 'help.row.close-workspace',
        },
        {
          combos: [acceleratorToKeyLabelsForHelp(isMac ? SETTINGS_SHORTCUT_MAC : SETTINGS_SHORTCUT_NON_MAC, isMac)],
          labelKey: 'help.row.settings',
        },
        ...CLIENT_APP_SHORTCUTS.map(helpRowFromKeyboardDefinition),
      ],
    },
  ]
}

function workspaceTabShortcutRow(isMac: boolean): HelpShortcutRow {
  const modifier = isMac ? '⌘' : '⌃'
  return {
    combos: [[modifier, '1-9']],
    labelKey: 'help.row.select-workspace-tab',
  }
}

function helpRowFromKeyboardDefinition(shortcut: { combos: string[][]; labelKey: DictKey }): HelpShortcutRow {
  return { combos: shortcut.combos, labelKey: shortcut.labelKey }
}

function helpRowFromAccelerator(
  shortcut: { accelerator: string; labelKey: DictKey; labelParams?: Record<string, string | number> },
  isMac: boolean,
): HelpShortcutRow {
  return {
    combos: [acceleratorToKeyLabelsForHelp(shortcut.accelerator, isMac)],
    labelKey: shortcut.labelKey,
    labelParams: shortcut.labelParams,
  }
}

function acceleratorToKeyLabelsForHelp(accelerator: string, isMac: boolean): string[] {
  return accelerator.split('+').map((token) => {
    if (token === 'CmdOrCtrl') return isMac ? '⌘' : '⌃'
    if (token === 'Cmd' || token === 'Command') return '⌘'
    if (token === 'Ctrl' || token === 'Control') return '⌃'
    if (token === 'Alt' || token === 'Option') return '⌥'
    if (token === 'Shift') return '⇧'
    if (token === 'Enter') return '↩'
    return token
  })
}

function inferIsMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
