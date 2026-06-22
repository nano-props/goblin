import { describe, expect, test } from 'vitest'
import { helpShortcutSections } from '#/web/keyboard/help-shortcuts.ts'

describe('helpShortcutSections', () => {
  test('formats accelerator-backed help rows for macOS', () => {
    const sections = helpShortcutSections('Alt+G', true)
    const nav = sections[0]?.rows
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(nav?.find((row) => row.labelKey === 'help.row.next-repo')?.combos).toEqual([['⌘', ']']])
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos[0]).toEqual(['⌘', '1'])
    expect(app?.find((row) => row.labelKey === 'help.row.new-terminal')?.combos).toEqual([['⌘', 'N']])
    expect(view?.find((row) => row.labelKey === 'workspace.focus-toggle-label')?.combos).toEqual([['⌘', 'B']])
    expect(app?.find((row) => row.labelKey === 'help.row.settings')?.combos).toEqual([['⌘', ',']])
  })

  test('formats accelerator-backed help rows for non-mac platforms', () => {
    const sections = helpShortcutSections('Alt+G', false)
    const nav = sections[0]?.rows
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(nav?.find((row) => row.labelKey === 'help.row.prev-repo')?.combos).toEqual([['⌃', '[']])
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos[8]).toEqual(['⌃', '9'])
    expect(view?.find((row) => row.labelKey === 'workspace.focus-toggle-label')?.combos).toEqual([['⌃', 'B']])
    expect(app?.find((row) => row.labelKey === 'help.row.close-workspace-tab-or-window')?.combos).toEqual([['⌃', 'W']])
    expect(app?.find((row) => row.labelKey === 'help.row.close-repo')?.combos).toEqual([['⌃', '⇧', 'W']])
    expect(app?.find((row) => row.labelKey === 'help.row.settings')?.combos).toEqual([['⌃', ',']])
  })
})
