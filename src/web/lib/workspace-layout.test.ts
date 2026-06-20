import { describe, expect, test } from 'vitest'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('repoWorkspaceBehavior', () => {
  test('renders the split workspace behavior when Branch View is visible', () => {
    expect(repoWorkspaceBehavior('left-right', true)).toMatchObject({
      mode: 'split',
      branchListPaneVisible: true,
      branchListActionsVisible: true,
    })
  })

  test('renders only the workspace pane when Branch View is hidden', () => {
    expect(repoWorkspaceBehavior('left-right', false)).toMatchObject({
      mode: 'workspace-only',
      branchListPaneVisible: false,
      branchListActionsVisible: false,
    })
  })
})
