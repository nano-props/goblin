import { describe, expect, test } from 'vitest'
import { effectiveWorkspaceLayout, repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('effectiveWorkspaceLayout', () => {
  test('keeps top-bottom on small screens', () => {
    expect(effectiveWorkspaceLayout('top-bottom', 'compact')).toBe('top-bottom')
  })

  test('downgrades left-right to top-bottom on small screens', () => {
    expect(effectiveWorkspaceLayout('left-right', 'compact')).toBe('top-bottom')
  })

  test('preserves left-right on larger screens', () => {
    expect(effectiveWorkspaceLayout('left-right', 'default')).toBe('left-right')
  })
})

describe('repoWorkspaceBehavior', () => {
  test('moves branch actions out of the list in top-bottom focus mode', () => {
    expect(repoWorkspaceBehavior('top-bottom', false, true)).toMatchObject({
      mode: 'focus',
      detailFocusMode: true,
      branchListActionsVisible: false,
    })
  })

  test('keeps branch list actions visible when focus preference is on but detail is collapsed', () => {
    expect(repoWorkspaceBehavior('top-bottom', true, true)).toMatchObject({
      mode: 'collapsed',
      detailFocusMode: true,
      branchListActionsVisible: true,
    })
  })
})
