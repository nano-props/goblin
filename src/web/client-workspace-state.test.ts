// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'
import {
  normalizeClientWorkspaceState,
  readClientWorkspaceState,
  writeClientWorkspaceState,
} from '#/web/client-workspace-state.ts'

beforeEach(() => localStorage.clear())

describe('client workspace persistence', () => {
  test('preserves four open repos in picker order across a local reload', async () => {
    const openRepoEntries = ['/repo-a', '/repo-b', '/repo-c', '/repo-d'].map((id) => ({
      kind: 'local' as const,
      id,
    }))

    await writeClientWorkspaceState(normalizeClientWorkspaceState({ openRepoEntries }))

    expect((await readClientWorkspaceState()).openRepoEntries).toEqual(openRepoEntries)
  })

  test('round-trips client-owned presentation without server workspace fields', async () => {
    const presentation = normalizeClientWorkspaceState({
      restoredRepoId: '/repo-a',
      zenMode: true,
      workspacePaneSize: 52,
      selectedTerminalSessionIdByTerminalWorktree: { '/repo-a\0/worktree': 'term-111' },
      preferredWorkspacePaneTabByTargetByRepo: { '/repo-a': { target: 'history' } },
      filetreeViewStateByWorktreeByRepo: {
        '/repo-a': {
          '/worktree': { selectedKeys: ['README.md'], expandedKeys: ['src'], topVisibleRowIndex: 7 },
        },
      },
      openRepoEntries: [{ kind: 'local', id: '/repo-a' }],
      workspacePaneTabsByTargetByRepo: { '/must-not-persist': {} },
    })

    await writeClientWorkspaceState(presentation)

    expect(await readClientWorkspaceState()).toEqual(presentation)
    const raw = JSON.parse(localStorage.getItem('goblin.workspace') ?? '{}')
    expect(raw.openRepoEntries).toEqual([{ kind: 'local', id: '/repo-a' }])
    expect(raw).not.toHaveProperty('workspacePaneTabsByTargetByRepo')
  })

  test('normalizes malformed local presentation to safe defaults', async () => {
    localStorage.setItem(
      'goblin.workspace',
      JSON.stringify({
        restoredRepoId: '',
        zenMode: 'yes',
        workspacePaneSize: Number.NaN,
        selectedTerminalSessionIdByTerminalWorktree: { broken: 12 },
        preferredWorkspacePaneTabByTargetByRepo: { '/repo-a': { target: 'unknown' } },
        filetreeViewStateByWorktreeByRepo: [],
      }),
    )

    expect(await readClientWorkspaceState()).toEqual({
      openRepoEntries: [],
      restoredRepoId: null,
      zenMode: false,
      workspacePaneSize: 70,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    })
  })
})
