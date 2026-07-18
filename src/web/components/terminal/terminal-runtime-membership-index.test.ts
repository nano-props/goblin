import { describe, expect, test } from 'vitest'
import {
  runtimeMembershipIndexFromEntries,
  type TerminalRuntimeMembershipEntry,
} from '#/web/components/terminal/terminal-runtime-membership-index.ts'

const REPO_ID = 'goblin+file:///tmp/terminal-runtime-membership-index-repo'

describe('terminal repo index', () => {
  test('projects open runtime membership without loading Git data', () => {
    const entries: TerminalRuntimeMembershipEntry[] = [
      {
        id: REPO_ID,
        repoRuntimeId: 'repo-runtime-terminal-index',
      },
    ]

    const index = runtimeMembershipIndexFromEntries(entries)

    expect(index).toEqual({ [REPO_ID]: { repoRuntimeId: 'repo-runtime-terminal-index' } })
  })
})
