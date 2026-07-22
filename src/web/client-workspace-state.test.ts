// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  readClientWorkspaceState,
  writeClientWorkspaceState,
} from '#/web/client-workspace-state.ts'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import * as nativeBridge from '#/web/native-bridge.ts'
import * as nativeHostClient from '#/web/native-host-client.ts'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('client workspace persistence', () => {
  test('fails fast when native workspace state cannot be read', async () => {
    const readError = new Error('native workspace unavailable')
    vi.spyOn(nativeBridge, 'readNativeBridge').mockReturnValue({} as Window['goblinNative'])
    vi.spyOn(nativeHostClient, 'invokeNativeIpcPath').mockRejectedValue(readError)

    await expect(readClientWorkspaceState()).rejects.toBe(readError)
  })

  test('replaces corrupt browser state with defaults', async () => {
    localStorage.setItem('goblin.workspace', '{broken json')
    await expect(readClientWorkspaceState()).resolves.toEqual(currentState())
    expect(JSON.parse(localStorage.getItem('goblin.workspace') ?? '')).toEqual(currentState())
  })

  test('replaces an empty value once and reads the committed defaults thereafter', async () => {
    localStorage.setItem('goblin.workspace', '')
    const setItem = vi.spyOn(localStorage, 'setItem')

    await expect(readClientWorkspaceState()).resolves.toEqual(currentState())
    await expect(readClientWorkspaceState()).resolves.toEqual(currentState())

    expect(JSON.parse(localStorage.getItem('goblin.workspace') ?? '')).toEqual(currentState())
    expect(setItem).toHaveBeenCalledOnce()
  })

  test('rejects a structurally corrupt native root', async () => {
    vi.spyOn(nativeBridge, 'readNativeBridge').mockReturnValue({} as Window['goblinNative'])
    vi.spyOn(nativeHostClient, 'invokeNativeIpcPath').mockResolvedValue({
      kind: 'loaded',
      state: [],
    })
    await expect(readClientWorkspaceState()).rejects.toThrow('Corrupt native client workspace state')
  })

  test('round-trips client-owned presentation without server workspace fields', async () => {
    const presentation = currentState({
      restoredWorkspaceId: workspaceIdForTest('goblin+file:///repo-a'),
      zenMode: true,
      workspacePaneSize: 52,
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        'goblin+file:///repo-a\0goblin+file:///worktree': 'term-111',
      },
      preferredWorkspacePaneTabByTargetByWorkspace: {
        'goblin+file:///repo-a': { 'goblin+file:///repo-a\0workspace-root': 'history' },
      },
      filetreeViewStateByFilesystemTargetByWorkspace: {
        'goblin+file:///repo-a': {
          'goblin+file:///worktree': { selectedKeys: ['README.md'], expandedKeys: ['src'], topVisibleRowIndex: 7 },
        },
      },
    })

    await writeClientWorkspaceState(presentation)

    expect(await readClientWorkspaceState()).toEqual(presentation)
    const raw = JSON.parse(localStorage.getItem('goblin.workspace') ?? '{}')
    expect(raw).toEqual(presentation)
  })

  test('replaces parseable corruption in the current browser format', async () => {
    const corrupt = JSON.stringify({ ...currentState(), zenMode: 'yes' })
    localStorage.setItem('goblin.workspace', corrupt)
    await expect(readClientWorkspaceState()).resolves.toEqual(currentState())
    expect(JSON.parse(localStorage.getItem('goblin.workspace') ?? '')).toEqual(currentState())
  })

  test('replaces an obsolete browser version envelope', async () => {
    const future = JSON.stringify({ version: 2, state: {} })
    localStorage.setItem('goblin.workspace', future)

    await expect(readClientWorkspaceState()).resolves.toEqual(currentState())
    expect(JSON.parse(localStorage.getItem('goblin.workspace') ?? '')).toEqual(currentState())
  })

  test('fails closed when browser storage is unavailable for reads and writes', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
    try {
      await expect(readClientWorkspaceState()).rejects.toThrow('Browser storage unavailable')
      await expect(writeClientWorkspaceState(currentState())).rejects.toThrow(
        'Browser storage unavailable',
      )
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })

  test('uses the atomic single-key storage boundary without Web Locks', async () => {
    const request = vi.fn(() => Promise.reject(new Error('lock must not be used')))
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const state = currentState({ zenMode: true })

    await writeClientWorkspaceState(state)

    await expect(readClientWorkspaceState()).resolves.toEqual(state)
    expect(request).not.toHaveBeenCalled()
  })

  test('accepts a valid current state independently of object property order', async () => {
    const state = currentState({ zenMode: true, workspacePaneSize: 52 })
    const reordered = {
      filetreeViewStateByFilesystemTargetByWorkspace: state.filetreeViewStateByFilesystemTargetByWorkspace,
      preferredWorkspacePaneTabByTargetByWorkspace: state.preferredWorkspacePaneTabByTargetByWorkspace,
      selectedTerminalSessionIdByTerminalFilesystemTarget: state.selectedTerminalSessionIdByTerminalFilesystemTarget,
      workspacePaneSize: state.workspacePaneSize,
      zenMode: state.zenMode,
      restoredWorkspaceId: state.restoredWorkspaceId,
    }
    localStorage.setItem('goblin.workspace', JSON.stringify(reordered))

    await expect(readClientWorkspaceState()).resolves.toEqual(state)
  })

  test('replaces state with unknown root data', async () => {
    const raw = JSON.stringify({ ...currentState(), unknownRoot: 'preserve' })
    localStorage.setItem('goblin.workspace', raw)

    await expect(readClientWorkspaceState()).resolves.toEqual(currentState())
    expect(JSON.parse(localStorage.getItem('goblin.workspace') ?? '')).toEqual(currentState())
  })
})

function currentState(overrides: Partial<ClientWorkspaceState> = {}): ClientWorkspaceState {
  return { ...defaultClientWorkspaceState(), ...overrides }
}
