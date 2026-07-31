// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  TerminalBellRealtimeEvent,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionClosedEvent,
  TerminalTitleEvent,
} from '#/shared/terminal-types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
  EMPTY_TERMINAL_SNAPSHOT,
  useTerminalSessionContext,
  useTerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalIdentityRealtimeEvent,
  TerminalLifecycleRealtimeEvent,
  TerminalRuntimeMembershipIndex,
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
} from '#/web/components/terminal/types.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'

const projection = vi.hoisted(() => ({
  setRuntimeMembershipIndex: vi.fn(),
  setPreferredSelectedTerminalSessionIds: vi.fn(),
  handleOutput: vi.fn(),
  handleServerBell: vi.fn(),
  handleServerTitle: vi.fn(),
  handleExit: vi.fn(),
  handleIdentity: vi.fn(),
  handleLifecycle: vi.fn(),
  handleSessionClosed: vi.fn(),
  terminalFilesystemTargetSnapshot: vi.fn(() => EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT),
  subscribeTerminalFilesystemTarget: vi.fn(() => () => {}),
  workspaceBellCount: vi.fn(() => 0),
  subscribeWorkspaceBellCount: vi.fn(() => () => {}),
  snapshot: vi.fn(() => EMPTY_TERMINAL_SNAPSHOT),
  subscribeSnapshot: vi.fn(() => () => {}),
  createTerminal: vi.fn(),
  createTerminalWithAdmission: vi.fn(),
  selectTerminal: vi.fn(),
  scrollToBottom: vi.fn(),
  scrollLines: vi.fn(),
  clearBell: vi.fn(),
  closeTerminalByDescriptor: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  restart: vi.fn(),
  focusTerminal: vi.fn(),
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  clearSearch: vi.fn(),
  captureInputWriter: vi.fn(),
  sendVirtualKey: vi.fn(),
  setComposerExpanded: vi.fn(),
  setComposerMode: vi.fn(),
  setComposerDraft: vi.fn(),
  replaceComposerDraft: vi.fn(),
  submitText: vi.fn(),
  takeover: vi.fn(),
  retryPresentation: vi.fn(),
}))

const geometryMocks = vi.hoisted(() => ({ preloadTerminalFont: vi.fn(async () => {}) }))
const runtimeMembershipIndex = vi.hoisted<TerminalRuntimeMembershipIndex>(() => new Map())

type RealtimeListeners = {
  output: ((event: TerminalOutputEvent) => void) | null
  bell: ((event: TerminalBellRealtimeEvent) => void) | null
  title: ((event: TerminalTitleEvent) => void) | null
  exit: ((event: TerminalExitEvent) => void) | null
  identity: ((event: TerminalIdentityRealtimeEvent) => void) | null
  lifecycle: ((event: TerminalLifecycleRealtimeEvent) => void) | null
  sessionClosed: ((event: TerminalSessionClosedEvent) => void) | null
}

const realtime = vi.hoisted(() => {
  const listeners: RealtimeListeners = {
    output: null,
    bell: null,
    title: null,
    exit: null,
    identity: null,
    lifecycle: null,
    sessionClosed: null,
  }

  function subscribe<K extends keyof RealtimeListeners>(key: K, listener: NonNullable<RealtimeListeners[K]>) {
    listeners[key] = listener
    return () => {
      if (listeners[key] === listener) listeners[key] = null
    }
  }

  function requireListener<K extends keyof RealtimeListeners>(key: K): NonNullable<RealtimeListeners[K]> {
    const listener = listeners[key]
    if (!listener) throw new Error(`TerminalSessionProvider did not subscribe to ${key}`)
    return listener
  }

  return {
    listeners,
    subscribe,
    emitOutput: (event: TerminalOutputEvent) => requireListener('output')(event),
    emitBell: (event: TerminalBellRealtimeEvent) => requireListener('bell')(event),
    emitTitle: (event: TerminalTitleEvent) => requireListener('title')(event),
    emitExit: (event: TerminalExitEvent) => requireListener('exit')(event),
    emitIdentity: (event: TerminalIdentityRealtimeEvent) => requireListener('identity')(event),
    emitLifecycle: (event: TerminalLifecycleRealtimeEvent) => requireListener('lifecycle')(event),
    emitSessionClosed: (event: TerminalSessionClosedEvent) => requireListener('sessionClosed')(event),
    reset() {
      for (const key of Object.keys(listeners) as Array<keyof RealtimeListeners>) listeners[key] = null
    },
  }
})

vi.mock('#/web/components/terminal/use-terminal-session-projection.ts', () => ({
  useTerminalSessionProjection: () => projection,
}))

vi.mock('#/web/components/terminal/terminal-runtime-membership-index.ts', () => ({
  useTerminalRuntimeMembershipIndex: () => runtimeMembershipIndex,
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => geometryMocks)

vi.mock('#/web/terminal.ts', () => ({
  terminalClient: {
    onOutput: (listener: NonNullable<RealtimeListeners['output']>) => realtime.subscribe('output', listener),
    onBell: (listener: NonNullable<RealtimeListeners['bell']>) => realtime.subscribe('bell', listener),
    onTitle: (listener: NonNullable<RealtimeListeners['title']>) => realtime.subscribe('title', listener),
    onExit: (listener: NonNullable<RealtimeListeners['exit']>) => realtime.subscribe('exit', listener),
    onIdentity: (listener: NonNullable<RealtimeListeners['identity']>) => realtime.subscribe('identity', listener),
    onLifecycle: (listener: NonNullable<RealtimeListeners['lifecycle']>) => realtime.subscribe('lifecycle', listener),
    onSessionClosed: (listener: NonNullable<RealtimeListeners['sessionClosed']>) =>
      realtime.subscribe('sessionClosed', listener),
  },
}))

import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/terminal-provider-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'
const TERMINAL_RUNTIME_SESSION_ID = 'pty_test_aaaaaaaaa'

beforeEach(() => {
  resetWorkspacesStore()
  realtime.reset()
  vi.clearAllMocks()
})

describe('TerminalSessionProvider', () => {
  test('forwards every realtime event to the client-level projection', () => {
    const output = outputEventFixture()
    const bell: TerminalBellRealtimeEvent = {
      terminalRuntimeSessionId: TERMINAL_RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      terminalSessionId: TERMINAL_SESSION_ID,
      workspaceId: WORKSPACE_ID,
      processName: 'zsh',
      canonicalTitle: null,
    }
    const title: TerminalTitleEvent = {
      terminalRuntimeSessionId: TERMINAL_RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      terminalSessionId: TERMINAL_SESSION_ID,
      workspaceId: WORKSPACE_ID,
      canonicalTitle: 'terminal title',
    }
    const exit: TerminalExitEvent = {
      terminalRuntimeSessionId: TERMINAL_RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      terminalSessionId: TERMINAL_SESSION_ID,
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: null,
    }
    const identity: TerminalIdentityRealtimeEvent = {
      terminalRuntimeSessionId: TERMINAL_RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      terminalSessionId: TERMINAL_SESSION_ID,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    }
    const lifecycle: TerminalLifecycleRealtimeEvent = {
      terminalRuntimeSessionId: TERMINAL_RUNTIME_SESSION_ID,
      terminalRuntimeGeneration: 1,
      terminalSessionId: TERMINAL_SESSION_ID,
      phase: 'open',
      message: null,
    }
    const sessionClosed = sessionClosedEventFixture()
    const result = renderProvider()

    realtime.emitOutput(output)
    realtime.emitBell(bell)
    realtime.emitTitle(title)
    realtime.emitExit(exit)
    realtime.emitIdentity(identity)
    realtime.emitLifecycle(lifecycle)
    realtime.emitSessionClosed(sessionClosed)

    expect(projection.handleOutput).toHaveBeenCalledWith(output)
    expect(projection.handleServerBell).toHaveBeenCalledWith(bell)
    expect(projection.handleServerTitle).toHaveBeenCalledWith(title)
    expect(projection.handleExit).toHaveBeenCalledWith(exit)
    expect(projection.handleIdentity).toHaveBeenCalledWith(identity)
    expect(projection.handleLifecycle).toHaveBeenCalledWith(lifecycle)
    expect(projection.handleSessionClosed).toHaveBeenCalledWith(sessionClosed)
    result.unmount()
  })

  test('synchronizes runtime membership and persisted selection into the projection', async () => {
    const result = renderProvider()

    expect(projection.setRuntimeMembershipIndex).toHaveBeenLastCalledWith(runtimeMembershipIndex)
    expect(projection.setPreferredSelectedTerminalSessionIds).toHaveBeenLastCalledWith({})

    await act(async () => {
      useWorkspacesStore.setState({
        selectedTerminalSessionIdByTerminalFilesystemTarget: { target: TERMINAL_SESSION_ID },
      })
    })

    expect(projection.setPreferredSelectedTerminalSessionIds).toHaveBeenLastCalledWith({
      target: TERMINAL_SESSION_ID,
    })
    result.unmount()
  })

  test('prewarms the terminal font on mount', () => {
    const result = renderProvider()
    expect(geometryMocks.preloadTerminalFont).toHaveBeenCalledTimes(1)
    result.unmount()
  })

  test('publishes projection commands and reads through the provider contexts', () => {
    const captured = renderProviderWithContexts()

    expect(captured.command).toStrictEqual({
      createTerminal: projection.createTerminal,
      createTerminalWithAdmission: projection.createTerminalWithAdmission,
      selectTerminal: projection.selectTerminal,
      scrollToBottom: projection.scrollToBottom,
      scrollLines: projection.scrollLines,
      clearBell: projection.clearBell,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
      attach: projection.attach,
      detach: projection.detach,
      restart: projection.restart,
      focusTerminal: projection.focusTerminal,
      findNext: projection.findNext,
      findPrevious: projection.findPrevious,
      clearSearch: projection.clearSearch,
      captureInputWriter: projection.captureInputWriter,
      sendVirtualKey: projection.sendVirtualKey,
      setComposerExpanded: projection.setComposerExpanded,
      setComposerMode: projection.setComposerMode,
      setComposerDraft: projection.setComposerDraft,
      replaceComposerDraft: projection.replaceComposerDraft,
      submitText: projection.submitText,
      takeover: projection.takeover,
      retryPresentation: projection.retryPresentation,
    })
    expect(captured.read).toEqual({
      terminalFilesystemTargetSnapshot: projection.terminalFilesystemTargetSnapshot,
      subscribeTerminalFilesystemTarget: projection.subscribeTerminalFilesystemTarget,
      workspaceBellCount: projection.workspaceBellCount,
      subscribeWorkspaceBellCount: projection.subscribeWorkspaceBellCount,
      snapshot: projection.snapshot,
      subscribeSnapshot: projection.subscribeSnapshot,
    })
    expect(readTerminalSessionCommandBridge()).toEqual({
      terminalFilesystemTargetSnapshot: projection.terminalFilesystemTargetSnapshot,
      createTerminal: projection.createTerminal,
      createTerminalWithAdmission: projection.createTerminalWithAdmission,
      selectTerminal: projection.selectTerminal,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
      focusTerminal: projection.focusTerminal,
    })
    captured.unmount()
  })

  test('unsubscribes realtime events and clears the command bridge on unmount', () => {
    const result = renderProvider()
    expect(readTerminalSessionCommandBridge()).not.toBeNull()

    result.unmount()

    expect(readTerminalSessionCommandBridge()).toBeNull()
    expect(Object.values(realtime.listeners)).toEqual([null, null, null, null, null, null, null])
  })
})

function renderProvider() {
  return renderInJsdom(
    <TerminalSessionProvider>
      <span>probe</span>
    </TerminalSessionProvider>,
  )
}

function outputEventFixture(): TerminalOutputEvent {
  return {
    terminalRuntimeSessionId: TERMINAL_RUNTIME_SESSION_ID,
    terminalRuntimeGeneration: 1,
    terminalSessionId: TERMINAL_SESSION_ID,
    data: 'hello',
    seq: 1,
    processName: 'zsh',
  }
}

function sessionClosedEventFixture(): TerminalSessionClosedEvent {
  return {
    terminalRuntimeSessionId: TERMINAL_RUNTIME_SESSION_ID,
    terminalRuntimeGeneration: 1,
    terminalSessionId: TERMINAL_SESSION_ID,
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    tabsBeforeRetirement: null,
  }
}

function renderProviderWithContexts(): {
  command: TerminalSessionContextValue
  read: TerminalSessionReadContextValue
  unmount: () => void
} {
  let command: TerminalSessionContextValue | null = null
  let read: TerminalSessionReadContextValue | null = null

  function CaptureContexts() {
    command = useTerminalSessionContext()
    read = useTerminalSessionReadContext()
    return null
  }

  const result = renderInJsdom(
    <TerminalSessionProvider>
      <CaptureContexts />
    </TerminalSessionProvider>,
  )
  if (!command || !read) throw new Error('TerminalSessionProvider contexts were not captured')
  return { command, read, unmount: result.unmount }
}
