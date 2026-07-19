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
  test('accepts canonical workspace IDs without Node path APIs', () => {
    expect(normalizeClientWorkspaceState({ restoredWorkspaceId: 'goblin+file:///repo' }).restoredWorkspaceId).toBe(
      'goblin+file:///repo',
    )
    expect(normalizeClientWorkspaceState({ restoredWorkspaceId: 'C:\\repo' }).restoredWorkspaceId).toBeNull()
    expect(normalizeClientWorkspaceState({ restoredWorkspaceId: 'relative/repo' }).restoredWorkspaceId).toBeNull()
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
      restoredWorkspaceId: 'goblin+file:///repo-a',
      zenMode: true,
      workspacePaneSize: 52,
      selectedTerminalSessionIdByTerminalWorktree: {
        'goblin+file:///repo-a\0goblin+file:///worktree': 'term-111',
      },
      preferredWorkspacePaneTabByTargetByWorkspace: {
        'goblin+file:///repo-a': { 'goblin+file:///repo-a\0workspace-root': 'history' },
      },
      filetreeViewStateByWorktreeByWorkspace: {
        'goblin+file:///repo-a': {
          'goblin+file:///worktree': { selectedKeys: ['README.md'], expandedKeys: ['src'], topVisibleRowIndex: 7 },
        },
      },
      workspacePaneTabsByTargetByWorkspace: { '/must-not-persist': {} },
    })

    await writeClientWorkspaceState(presentation)

    expect(await readClientWorkspaceState()).toEqual(presentation)
    const raw = JSON.parse(localStorage.getItem('goblin.workspace') ?? '{}')
    expect(raw).not.toHaveProperty('openWorkspaceEntries')
    expect(raw).not.toHaveProperty('workspacePaneTabsByTargetByWorkspace')
  })

  test('preserves Windows workspace identities throughout nested presentation state on a non-Windows host', () => {
    const workspaceId = 'goblin+file:///C:/workspace'
    const worktreeId = 'goblin+file:///C:/workspace-feature'
    const terminalKey = `${workspaceId}\0${worktreeId}`
    const rootTargetKey = `${workspaceId}\0workspace-root`

    expect(
      normalizeClientWorkspaceState({
        restoredWorkspaceId: workspaceId,
        selectedTerminalSessionIdByTerminalWorktree: { [terminalKey]: 'terminal-session-test' },
        preferredWorkspacePaneTabByTargetByWorkspace: {
          [workspaceId]: { [rootTargetKey]: 'files' },
        },
        filetreeViewStateByWorktreeByWorkspace: {
          [workspaceId]: {
            [worktreeId]: { selectedKeys: ['README.md'], expandedKeys: ['src'], topVisibleRowIndex: 2 },
          },
        },
      }),
    ).toMatchObject({
      restoredWorkspaceId: workspaceId,
      selectedTerminalSessionIdByTerminalWorktree: { [terminalKey]: 'terminal-session-test' },
      preferredWorkspacePaneTabByTargetByWorkspace: { [workspaceId]: { [rootTargetKey]: 'files' } },
      filetreeViewStateByWorktreeByWorkspace: {
        [workspaceId]: {
          [worktreeId]: { selectedKeys: ['README.md'], expandedKeys: ['src'], topVisibleRowIndex: 2 },
        },
      },
    })
  })

  test('normalizes malformed local presentation to safe defaults', async () => {
    localStorage.setItem(
      'goblin.workspace',
      JSON.stringify({
        restoredWorkspaceId: '',
        zenMode: 'yes',
        workspacePaneSize: Number.NaN,
        selectedTerminalSessionIdByTerminalWorktree: { broken: 12 },
        preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///repo-a': { target: 'unknown' } },
        filetreeViewStateByWorktreeByWorkspace: [],
      }),
    )

    expect(await readClientWorkspaceState()).toEqual({
      restoredWorkspaceId: null,
      zenMode: false,
      workspacePaneSize: 70,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByWorkspace: {},
      filetreeViewStateByWorktreeByWorkspace: {},
    })
  })

  test('drops legacy raw-path and cross-transport persisted identities', () => {
    expect(
      normalizeClientWorkspaceState({
        selectedTerminalSessionIdByTerminalWorktree: {
          'goblin+file:///repo-a\0/worktree': 'term-legacy',
          'goblin+file:///repo-a\0goblin+ssh://dev/worktree': 'term-cross-transport',
        },
        preferredWorkspacePaneTabByTargetByWorkspace: {
          'goblin+file:///repo-a': {
            target: 'history',
            'goblin+file:///repo-a\0worktree\0/worktree': 'files',
          },
        },
        filetreeViewStateByWorktreeByWorkspace: {
          'goblin+file:///repo-a': {
            '/worktree': { selectedKeys: ['README.md'], expandedKeys: [], topVisibleRowIndex: 0 },
            'goblin+ssh://dev/worktree': {
              selectedKeys: ['README.md'],
              expandedKeys: [],
              topVisibleRowIndex: 0,
            },
          },
        },
      }),
    ).toMatchObject({
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByWorkspace: {},
      filetreeViewStateByWorktreeByWorkspace: {},
    })
  })
})
