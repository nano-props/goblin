import type { DictKey } from '#/shared/i18n/en.ts'
import {
  APP_SHORTCUTS,
  BRANCH_ACTION_SHORTCUTS,
  CLIENT_APP_SHORTCUTS,
  CLIENT_NAVIGATION_SHORTCUTS,
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

export function helpShortcutSections(isMac = inferIsMacPlatform()): HelpShortcutSection[] {
  return [
    {
      titleKey: 'help.section.nav',
      rows: [...CLIENT_NAVIGATION_SHORTCUTS.map(helpRowFromKeyboardDefinition)],
    },
    {
      titleKey: 'help.section.branch-actions',
      rows: BRANCH_ACTION_SHORTCUTS.map(helpRowFromKeyboardDefinition),
    },
    {
      titleKey: 'help.section.views',
      rows: [workspaceTabShortcutRow(isMac)],
    },
    {
      titleKey: 'help.section.app',
      rows: [
        ...APP_SHORTCUTS.map((shortcut) => helpRowFromAccelerator(shortcut, isMac)),
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
