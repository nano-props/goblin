import { acceleratorToKeyLabels } from '#/shared/accelerator.ts'
export interface HelpShortcutRow {
  combos: string[][]
  labelKey: string
}

export interface HelpShortcutSection {
  titleKey: string
  rows: HelpShortcutRow[]
}

export function helpShortcutSections(globalShortcut: string, swapCloseShortcuts = false): HelpShortcutSection[] {
  const closeTabCombo = swapCloseShortcuts ? ['⌘', 'W'] : ['⌘', '⇧', 'W']
  const closeWindowCombo = swapCloseShortcuts ? ['⌘', '⇧', 'W'] : ['⌘', 'W']
  return [
    {
      titleKey: 'help.section.nav',
      rows: [
        { combos: [['j'], ['↓']], labelKey: 'help.row.next-branch' },
        { combos: [['k'], ['↑']], labelKey: 'help.row.prev-branch' },
        { combos: [['←'], ['→']], labelKey: 'help.row.switch-detail-tab' },
        { combos: [['⌘', ']']], labelKey: 'help.row.next-repo' },
        { combos: [['⌘', '[']], labelKey: 'help.row.prev-repo' },
      ],
    },
    {
      titleKey: 'help.section.branch-actions',
      rows: [
        { combos: [['Enter']], labelKey: 'help.row.checkout' },
        { combos: [['p']], labelKey: 'action.pull' },
        { combos: [['⇧', 'P']], labelKey: 'action.push' },
        { combos: [['g']], labelKey: 'worktrees.open-in-terminal-label' },
        { combos: [['v']], labelKey: 'worktrees.open-in-editor-label' },
        { combos: [['⇧', 'G']], labelKey: 'action.remote' },
      ],
    },
    {
      titleKey: 'help.section.views',
      rows: [
        { combos: [['⌘', '1']], labelKey: 'help.row.view-status' },
        { combos: [['⌘', '2']], labelKey: 'help.row.view-terminal' },
        { combos: [['⌘', '↩']], labelKey: 'help.row.terminal-primary-action' },
        { combos: [['⌘', 'J']], labelKey: 'help.row.toggle-detail' },
      ],
    },
    {
      titleKey: 'help.section.app',
      rows: [
        { combos: [['⌘', 'O']], labelKey: 'help.row.open-local-repo' },
        { combos: [['⌘', '⇧', 'O']], labelKey: 'help.row.clone-repo' },
        { combos: [acceleratorToKeyLabels(globalShortcut)], labelKey: 'help.row.activate-window' },
        { combos: [closeTabCombo], labelKey: 'help.row.close-repo' },
        { combos: [closeWindowCombo], labelKey: 'help.row.close-window' },
        { combos: [['⌘', 'U']], labelKey: 'help.row.refresh' },
        { combos: [['⌘', 'R']], labelKey: 'help.row.reload-page' },
        { combos: [['⌘', ',']], labelKey: 'help.row.settings' },
        { combos: [['?']], labelKey: 'help.row.this-help' },
        { combos: [['Esc']], labelKey: 'help.row.dismiss' },
      ],
    },
  ]
}
