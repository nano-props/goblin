// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  normalizeClientWorkspaceState,
  readClientWorkspaceState,
  writeClientWorkspaceState,
} from '#/web/client-workspace-state.ts'
import * as nativeBridge from '#/web/native-bridge.ts'
import * as nativeHostClient from '#/web/native-host-client.ts'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('client workspace persistence', () => {
  test('accepts canonical repo locators without Node path APIs', () => {
    expect(normalizeClientWorkspaceState({ restoredRepoId: 'C:\\repo' }).restoredRepoId).toBe('C:\\repo')
    expect(normalizeClientWorkspaceState({ restoredRepoId: 'relative/repo' }).restoredRepoId).toBeNull()
  })

  test('fails fast when native workspace state cannot be read', async () => {
    const readError = new Error('native workspace unavailable')
    vi.spyOn(nativeBridge, 'readNativeBridge').mockReturnValue({} as Window['goblinNative'])
    vi.spyOn(nativeHostClient, 'invokeNativeIpcPath').mockRejectedValue(readError)

    await expect(readClientWorkspaceState()).rejects.toBe(readError)
  })

  test('uses defaults only for an explicit native missing result', async () => {
    vi.spyOn(nativeBridge, 'readNativeBridge').mockReturnValue({} as Window['goblinNative'])
    vi.spyOn(nativeHostClient, 'invokeNativeIpcPath').mockResolvedValue({ kind: 'missing' })

    await expect(readClientWorkspaceState()).resolves.toEqual(normalizeClientWorkspaceState(null))
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
      workspacePaneTabsByTargetByRepo: { '/must-not-persist': {} },
    })

    await writeClientWorkspaceState(presentation)

    expect(await readClientWorkspaceState()).toEqual(presentation)
    const raw = JSON.parse(localStorage.getItem('goblin.workspace') ?? '{}')
    expect(raw).not.toHaveProperty('openRepoEntries')
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
      restoredRepoId: null,
      zenMode: false,
      workspacePaneSize: 70,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    })
  })
})
