import { describe, expect, test } from 'vitest'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

describe('repoWorkspaceBehavior', () => {
  test('uses focus mode to hide the branch list in left-right layout', () => {
    expect(repoWorkspaceBehavior('left-right', true)).toMatchObject({
      mode: 'focus',
      workspacePaneFocusMode: true,
      branchListActionsVisible: false,
    })
  })

  test('renders split mode when focus mode is off', () => {
    expect(repoWorkspaceBehavior('left-right', false)).toMatchObject({
      mode: 'split',
      branchListActionsVisible: true,
    })
  })
})
