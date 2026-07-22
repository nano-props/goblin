import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import {
  nativeProjectionFromSnapshots,
  startNativeSettingsProjectionSync,
  stopNativeSettingsProjectionSync,
} from '#/main/native-settings-projection-sync.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { applyNativeHostProjection } from '#/main/native-host-settings-effects.ts'
import { getSettingsSnapshot } from '#/main/settings-server-client.ts'
import { getEmbeddedServerRuntime } from '#/main/embedded-server-lifecycle.ts'

const websocketState = vi.hoisted(() => ({ instances: [] as Array<EventEmitter & { close: ReturnType<typeof vi.fn> }> }))

vi.mock('ws', () => ({
  default: class extends EventEmitter {
    close = vi.fn(() => this.emit('close'))

    constructor() {
      super()
      websocketState.instances.push(this)
    }
  },
}))

vi.mock('#/main/native-host-settings-effects.ts', () => ({ applyNativeHostProjection: vi.fn() }))
vi.mock('#/main/settings-server-client.ts', () => ({ getSettingsSnapshot: vi.fn() }))
vi.mock('#/main/embedded-server-lifecycle.ts', () => ({ getEmbeddedServerRuntime: vi.fn() }))

beforeEach(() => {
  vi.mocked(getEmbeddedServerRuntime).mockReturnValue({
    url: 'http://127.0.0.1:32099',
    host: '127.0.0.1',
    port: 32099,
    accessToken: 'test-token',
  })
})

afterEach(() => {
  stopNativeSettingsProjectionSync()
  websocketState.instances.length = 0
  vi.clearAllMocks()
  vi.useRealTimers()
})

async function flushRefreshQueue(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('derives native effects from complete authoritative settings snapshots', () => {
  const previous = defaultSettingsSnapshot()
  const current = defaultSettingsSnapshot({
    lang: 'ja',
    theme: 'dark',
    globalShortcut: 'Alt+K',
    recentWorkspaces: [{ id: workspaceIdForTest('goblin+file:///repo') }],
  })

  expect(nativeProjectionFromSnapshots(previous, current)).toEqual({
    prefs: {
      patch: { lang: 'ja', theme: 'dark', globalShortcut: 'Alt+K' },
      settings: {
        lang: 'ja',
        theme: 'dark',
        colorTheme: 'macos',
        shortcutsDisabled: false,
        globalShortcutDisabled: false,
        globalShortcut: 'Alt+K',
      },
    },
    recentWorkspaces: { recentWorkspaces: [{ id: 'goblin+file:///repo' }] },
  })
})

test('does not emit native work for an unchanged authoritative snapshot', () => {
  const snapshot = defaultSettingsSnapshot()
  expect(nativeProjectionFromSnapshots(snapshot, structuredClone(snapshot))).toBeNull()
})

test('reconciles the complete server snapshot whenever the socket opens', async () => {
  const initial = defaultSettingsSnapshot()
  const current = defaultSettingsSnapshot({ theme: 'dark' })
  vi.mocked(getSettingsSnapshot).mockResolvedValue(current)

  startNativeSettingsProjectionSync(initial)
  websocketState.instances[0]?.emit('open')
  await flushRefreshQueue()

  expect(applyNativeHostProjection).toHaveBeenCalledWith(expect.objectContaining({ prefs: expect.any(Object) }))
})

test('reconnect open reconciles settings changed while disconnected', async () => {
  vi.useFakeTimers()
  const initial = defaultSettingsSnapshot()
  vi.mocked(getSettingsSnapshot)
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(defaultSettingsSnapshot({ lang: 'ja' }))

  startNativeSettingsProjectionSync(initial)
  websocketState.instances[0]?.emit('open')
  await flushRefreshQueue()
  websocketState.instances[0]?.emit('close')
  await vi.advanceTimersByTimeAsync(300)
  websocketState.instances[1]?.emit('open')
  await flushRefreshQueue()

  expect(applyNativeHostProjection).toHaveBeenCalledTimes(1)
})

test('retries a failed native effect without advancing the authoritative baseline', async () => {
  const initial = defaultSettingsSnapshot()
  const current = defaultSettingsSnapshot({ theme: 'dark' })
  vi.mocked(getSettingsSnapshot).mockResolvedValue(current)
  vi.mocked(applyNativeHostProjection).mockRejectedValueOnce(new Error('effect failed')).mockResolvedValueOnce()

  startNativeSettingsProjectionSync(initial)
  websocketState.instances[0]?.emit('open')
  await flushRefreshQueue()
  websocketState.instances[0]?.emit(
    'message',
    JSON.stringify({ type: 'settings-invalidated', scopes: ['settings-snapshot'] }),
  )
  await flushRefreshQueue()

  expect(applyNativeHostProjection).toHaveBeenCalledTimes(2)
})
