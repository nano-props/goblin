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
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: vi.fn(async (_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) =>
        await callback({ name: 'goblin.client-workspace-state', mode: 'exclusive' }),
      ),
    },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('client workspace persistence', () => {
  test('fails fast when native workspace state cannot be read', async () => {
    const readError = new Error('native workspace unavailable')
    vi.spyOn(nativeBridge, 'readNativeBridge').mockReturnValue({} as Window['goblinNative'])
    vi.spyOn(nativeHostClient, 'invokeNativeIpcPath').mockRejectedValue(readError)

    await expect(readClientWorkspaceState()).rejects.toBe(readError)
  })

  test('uses defaults only for an explicit native missing result', async () => {
    vi.spyOn(nativeBridge, 'readNativeBridge').mockReturnValue({} as Window['goblinNative'])
    vi.spyOn(nativeHostClient, 'invokeNativeIpcPath').mockResolvedValue({ kind: 'missing' })

    await expect(readClientWorkspaceState()).resolves.toEqual(currentState())
  })

  test('preserves corrupt browser state and fails closed', async () => {
    localStorage.setItem('goblin.workspace', '{broken json')
    await expect(readClientWorkspaceState()).rejects.toBeInstanceOf(SyntaxError)
    expect(localStorage.getItem('goblin.workspace')).toBe('{broken json')
  })

  test('treats an empty authoritative value as corruption on every read without writing', async () => {
    localStorage.setItem('goblin.workspace', '')
    const setItem = vi.spyOn(localStorage, 'setItem')

    await expect(readClientWorkspaceState()).rejects.toBeInstanceOf(SyntaxError)
    await expect(readClientWorkspaceState()).rejects.toBeInstanceOf(SyntaxError)

    expect(localStorage.getItem('goblin.workspace')).toBe('')
    expect(setItem).not.toHaveBeenCalled()
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
    expect(raw).toMatchObject({ version: 1, state: presentation })
  })

  test('preserves parseable corruption in the current browser format', async () => {
    const corrupt = JSON.stringify({ version: 1, state: { zenMode: 'yes' } })
    localStorage.setItem('goblin.workspace', corrupt)
    await expect(readClientWorkspaceState()).rejects.toThrow()
    expect(localStorage.getItem('goblin.workspace')).toBe(corrupt)
  })

  test('preserves an unsupported future browser version and fails closed', async () => {
    const future = JSON.stringify({ version: 2, state: {} })
    localStorage.setItem('goblin.workspace', future)

    await expect(readClientWorkspaceState()).rejects.toThrow('Unsupported browser client workspace state version: 2')
    expect(localStorage.getItem('goblin.workspace')).toBe(future)
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

  test('fails closed when the cross-context workspace lock owner is unavailable', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })

    await expect(readClientWorkspaceState()).rejects.toThrow('Web Locks unavailable')
    await expect(writeClientWorkspaceState(currentState())).rejects.toThrow(
      'Web Locks unavailable',
    )
  })

  test('serializes browser reads and writes through the same exclusive cross-context lock', async () => {
    localStorage.setItem(
      'goblin.workspace',
      JSON.stringify({ version: 1, state: currentState() }),
    )

    await Promise.all([
      readClientWorkspaceState(),
      writeClientWorkspaceState(currentState({ zenMode: true })),
    ])

    expect(navigator.locks.request).toHaveBeenCalledTimes(2)
    expect(navigator.locks.request).toHaveBeenNthCalledWith(
      1,
      'goblin.client-workspace-state',
      { mode: 'exclusive' },
      expect.any(Function),
    )
    expect(navigator.locks.request).toHaveBeenNthCalledWith(
      2,
      'goblin.client-workspace-state',
      { mode: 'exclusive' },
      expect.any(Function),
    )
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
    localStorage.setItem('goblin.workspace', JSON.stringify({ version: 1, state: reordered }))

    await expect(readClientWorkspaceState()).resolves.toEqual(state)
  })

  test('preserves a current envelope with unknown root data and fails closed', async () => {
    const raw = JSON.stringify({ version: 1, state: currentState(), unknownRoot: 'preserve' })
    localStorage.setItem('goblin.workspace', raw)

    await expect(readClientWorkspaceState()).rejects.toThrow('Corrupt browser client workspace state envelope')
    expect(localStorage.getItem('goblin.workspace')).toBe(raw)
  })

  test('preserves unversioned state with unknown root data and fails closed', async () => {
    const raw = JSON.stringify({ ...currentState(), unknownLegacyRoot: 'preserve' })
    localStorage.setItem('goblin.workspace', raw)

    await expect(readClientWorkspaceState()).rejects.toThrow('Corrupt browser client workspace state envelope')
    expect(localStorage.getItem('goblin.workspace')).toBe(raw)
  })

})

function currentState(overrides: Partial<ClientWorkspaceState> = {}): ClientWorkspaceState {
  return { ...defaultClientWorkspaceState(), ...overrides }
}
