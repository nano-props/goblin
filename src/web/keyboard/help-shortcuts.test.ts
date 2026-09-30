import { describe, expect, test } from 'vitest'
import { helpShortcutSections } from '#/web/keyboard/help-shortcuts.ts'

describe('helpShortcutSections', () => {
  test('formats accelerator-backed help rows for macOS', () => {
    const sections = helpShortcutSections(true)
    const branchActions = sections[1]?.rows
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(app?.map((row) => row.labelKey)).toEqual(['help.row.reload-page', 'help.row.this-help', 'help.row.dismiss'])
    expect(branchActions?.find((row) => row.labelKey === 'action.pull')?.combos).toEqual([['P']])
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos).toEqual([['⌘', '1-9']])
  })

  test('formats accelerator-backed help rows for non-mac platforms', () => {
    const sections = helpShortcutSections(false)
    const view = sections[2]?.rows
    const app = sections[3]?.rows
    expect(app?.map((row) => row.labelKey)).toEqual(['help.row.reload-page', 'help.row.this-help', 'help.row.dismiss'])
    expect(view?.find((row) => row.labelKey === 'help.row.select-workspace-tab')?.combos).toEqual([['⌃', '1-9']])
  })
})
