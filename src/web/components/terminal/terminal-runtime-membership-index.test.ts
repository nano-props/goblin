import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  runtimeMembershipIndexFromEntries,
  type TerminalRuntimeMembershipEntry,
} from '#/web/components/terminal/terminal-runtime-membership-index.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/example-workspace')

describe('terminal repo index', () => {
  test('projects open runtime membership without loading Git data', () => {
    const entries: TerminalRuntimeMembershipEntry[] = [
      {
        id: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-terminal-index',
      },
    ]

    const index = runtimeMembershipIndexFromEntries(entries)

    expect(index).toEqual(new Map([[REPO_ID, { workspaceRuntimeId: 'repo-runtime-terminal-index' }]]))
  })
})
