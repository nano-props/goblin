import { describe, expect, test } from 'vitest'
import { helpShortcutSections } from '#/web/keyboard/help-shortcuts.ts'

describe('helpShortcutSections', () => {
  test('formats accelerator-backed help rows for macOS', () => {
    const sections = helpShortcutSections('Alt+G', true)
    const nav = sections[0]?.rows
    const branchActions = sections[1]?.rows
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(nav?.find((row) => row.labelKey === 'help.row.next-repo')?.combos).toEqual([['⌘', '⇧', ']']])
    expect(branchActions?.find((row) => row.labelKey === 'action.pull')?.combos).toEqual([['P']])
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos).toEqual([['⌘', '1-9']])
    expect(app?.find((row) => row.labelKey === 'help.row.new-terminal')?.combos).toEqual([['⌘', 'T']])
    expect(app?.find((row) => row.labelKey === 'help.row.create-worktree')?.combos).toEqual([['⌘', 'N']])
    expect(view?.find((row) => row.labelKey === 'workspace.zen-mode-toggle-label')?.combos).toEqual([['⌘', 'B']])
    expect(app?.find((row) => row.labelKey === 'help.row.settings')?.combos).toEqual([['⌘', ',']])
  })

  test('formats accelerator-backed help rows for non-mac platforms', () => {
    const sections = helpShortcutSections('Alt+G', false)
    const nav = sections[0]?.rows
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(nav?.find((row) => row.labelKey === 'help.row.prev-repo')?.combos).toEqual([['⌃', '⇧', '[']])
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos).toEqual([['⌃', '1-9']])
    expect(view?.find((row) => row.labelKey === 'workspace.zen-mode-toggle-label')?.combos).toEqual([['⌃', 'B']])
    expect(app?.find((row) => row.labelKey === 'help.row.close-workspace-tab-or-window')?.combos).toEqual([['⌃', 'W']])
    expect(app?.find((row) => row.labelKey === 'help.row.close-repo')?.combos).toEqual([['⌃', '⇧', 'W']])
    expect(app?.find((row) => row.labelKey === 'help.row.settings')?.combos).toEqual([['⌃', ',']])
  })
})
