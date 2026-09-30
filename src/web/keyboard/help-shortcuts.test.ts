import { describe, expect, test } from 'vitest'
import { helpShortcutSections } from '#/web/keyboard/help-shortcuts.ts'

describe('helpShortcutSections', () => {
  test('formats accelerator-backed help rows for macOS', () => {
    const sections = helpShortcutSections(true)
    const nav = sections[0]?.rows
    const branchActions = sections[1]?.rows
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(branchActions?.find((row) => row.labelKey === 'action.pull')?.combos).toEqual([['P']])
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos).toEqual([['⌘', '1-9']])
    expect(app?.find((row) => row.labelKey === 'help.row.new-terminal')?.combos).toEqual([['⌘', 'T']])
    expect(app?.find((row) => row.labelKey === 'help.row.create-worktree')?.combos).toEqual([['⌘', 'N']])
    expect(app?.find((row) => row.labelKey === 'help.row.close-workspace-tab')?.combos).toEqual([['⌘', 'W']])
  })

  test('formats accelerator-backed help rows for non-mac platforms', () => {
    const sections = helpShortcutSections(false)
    const nav = sections[0]?.rows
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos).toEqual([['⌃', '1-9']])
    expect(app?.find((row) => row.labelKey === 'help.row.close-workspace-tab')?.combos).toEqual([['⌃', 'W']])
  })
})
