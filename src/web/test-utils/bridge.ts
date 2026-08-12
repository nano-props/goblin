// Web client bridge helpers for tests that simulate the embedded server.
//
// This module owns transport wiring only: IPC/HTTP dispatch, terminal
// actions, workspace runtime events, and workspace-pane tab operations.
// Repo/store fixtures live in #/web/test-utils/repo-store.ts.

import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { RemoteWorkspaceRuntimeLifecycle } from '#/shared/remote-workspace.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import type {
  TerminalAttachResult,
  TerminalRestartResult,
  TerminalResizeResult,
  TerminalWriteResult,
  TerminalSessionsSnapshot,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsSnapshot, WorkspacePaneTabsWriteResult } from '#/shared/workspace-pane-tabs.ts'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeCloseResult,
  type WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import { vi } from 'vitest'
import { installWebSocketMock } from '#/web/test-utils/websocket-mock.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import { hasErrorCode } from '#/shared/error-code.ts'

export type IpcTestHandler = (input: any) => unknown
interface TerminalClientTestOutputs {
  'terminal.attach': TerminalAttachResult
  'terminal.restart': TerminalRestartResult
  'terminal.write': TerminalWriteResult
  'terminal.resize': TerminalResizeResult
  'terminal.takeover': TerminalTakeoverResult
  'terminal.recoverSessions': TerminalSessionsSnapshot
  'workspacePaneTabs.update': WorkspacePaneTabsWriteResult
  'workspacePaneTabs.list': WorkspacePaneTabsSnapshot
  'workspacePaneRuntime.open': WorkspacePaneRuntimeOpenResult
  'workspacePaneRuntime.close': WorkspacePaneRuntimeCloseResult
}

function terminalHandlerNameForSocketAction(action: string): keyof TerminalClientTestOutputs | null {
  switch (action) {
    case 'attach':
      return 'terminal.attach'
    case 'restart':
      return 'terminal.restart'
    case 'write':
      return 'terminal.write'
    case 'resize':
      return 'terminal.resize'
    case 'takeover':
      return 'terminal.takeover'
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update:
      return 'workspacePaneTabs.update'
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list:
      return 'workspacePaneTabs.list'
    case WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open:
      return 'workspacePaneRuntime.open'
    case WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close:
      return 'workspacePaneRuntime.close'
    case 'recover-sessions':
      return 'terminal.recoverSessions'
    default:
      return null
  }
}

export function installGoblinTestBridge(handlers: Record<string, IpcTestHandler>): void {
  setClientBridgeForTests(null)
  const workspaceRuntimeState = new Map<
    string,
    {
      currentWorkspaceRuntimeId: string | null
      members: Set<string>
      workspaceProbe?: WorkspaceProbeState
      remoteLifecycle?: RemoteWorkspaceRuntimeLifecycle
    }
  >()
  const sessionStorageValues = new Map<string, string>()
  const hostOpenExternalUrl = handlers['app.openExternalUrl']
  const hostOpenDirectoryDialog = handlers['workspace.openDialog']
  const hostConsumeExternalOpenPaths = handlers['repo.consumeExternalOpenPaths']
  const hostOpenSettingsWindow = handlers['app.openSettingsWindow']
  const browserWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: browserWindow.addEventListener.bind(browserWindow),
      removeEventListener: browserWindow.removeEventListener.bind(browserWindow),
      dispatchEvent: browserWindow.dispatchEvent.bind(browserWindow),
      __GOBLIN_BOOTSTRAP__: {
        runtime: {
          kind: 'electron',
          bridgeVersion: CLIENT_BRIDGE_VERSION,
          capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
        },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      },
      goblinNative: {
        invokeIpc: ({ path, input }: { path: string; input?: unknown }) => {
          const handler = handlers[path]
          if (!handler) throw new Error(`Unhandled IPC path: ${path}`)
          return handler(input)
        },
        abortIpc: () => Promise.resolve(false),
        notifyAppQuitDrained: () => Promise.resolve(true),
        onAppQuitting: () => () => {},
        onIntent: () => () => {},
        pathForFile: () => '',
        host: {
          openSettingsWindow: (input: unknown) =>
            hostOpenSettingsWindow ? Promise.resolve(hostOpenSettingsWindow(input)) : Promise.resolve(false),
          openExternalUrl: (input: unknown) =>
            hostOpenExternalUrl
              ? Promise.resolve(hostOpenExternalUrl(input))
              : Promise.resolve({ ok: false, message: 'error.invalid-url' }),
          openDirectoryDialog: (input: { title?: string }) => {
            const handler =
              input?.title === 'Choose Clone Destination' && handlers['repo.cloneParentDialog']
                ? handlers['repo.cloneParentDialog']
                : hostOpenDirectoryDialog
            return handler ? Promise.resolve(handler(input)) : Promise.resolve(null)
          },
          consumeExternalOpenPaths: () =>
            hostConsumeExternalOpenPaths
              ? Promise.resolve(hostConsumeExternalOpenPaths(undefined))
              : Promise.resolve([]),
        },
        terminal: {
          notifyBell: () => Promise.resolve(true),
          sendTestNotification: () => Promise.resolve(true),
          setBadge: () => {},
        },
        getAccessTokenProjection: () =>
          Promise.resolve({ accessToken: 'test-access-token', activation: 'current' as const }),
        rotateAccessToken: () =>
          Promise.resolve({ accessToken: 'test-access-token', activation: 'after-restart' as const }),
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        protocol: 'http:',
        search: '',
      },
      sessionStorage: {
        getItem: (key: string) => sessionStorageValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionStorageValues.set(key, value),
      },
    },
  })
  function callTerminalHandler(name: 'terminal.attach', payload: unknown): TerminalClientTestOutputs['terminal.attach']
  function callTerminalHandler(
    name: 'terminal.restart',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.restart']
  function callTerminalHandler(name: 'terminal.write', payload: unknown): TerminalClientTestOutputs['terminal.write']
  function callTerminalHandler(name: 'terminal.resize', payload: unknown): TerminalClientTestOutputs['terminal.resize']
  function callTerminalHandler(
    name: 'terminal.takeover',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.takeover']
  function callTerminalHandler(
    name: 'workspacePaneTabs.update',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneTabs.update']
  function callTerminalHandler(
    name: 'workspacePaneTabs.list',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneTabs.list']
  function callTerminalHandler(
    name: 'workspacePaneRuntime.open',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneRuntime.open']
  function callTerminalHandler(
    name: 'workspacePaneRuntime.close',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneRuntime.close']
  function callTerminalHandler(
    name: 'terminal.recoverSessions',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.recoverSessions']
  function callTerminalHandler(
    name: keyof TerminalClientTestOutputs,
    payload: unknown,
  ): TerminalClientTestOutputs[keyof TerminalClientTestOutputs]
  function callTerminalHandler(
    name: keyof TerminalClientTestOutputs,
    payload: unknown,
  ): TerminalClientTestOutputs[keyof TerminalClientTestOutputs] {
    const handler = handlers[name]
    if (!handler) {
      switch (name) {
        case 'terminal.attach':
        case 'terminal.restart':
          return { ok: false, message: `unhandled ${name}` }
        case 'terminal.write':
          throw new Error(`Unhandled terminal handler: ${name}`)
        case 'terminal.resize':
          return { ok: false, message: `unhandled ${name}` } satisfies TerminalResizeResult
        case 'terminal.takeover':
          throw new Error(`Unhandled terminal handler: ${name}`)
        case 'workspacePaneTabs.update':
          throw new Error(`Unhandled terminal handler: ${name}`)
        case 'workspacePaneTabs.list':
          return { revision: 0, entries: [] }
        case 'workspacePaneRuntime.close': {
          throw new Error(`Unhandled terminal handler: ${name}`)
        }
        case 'terminal.recoverSessions':
          return { revision: 0, sessions: [] }
        case 'workspacePaneRuntime.open':
          throw new Error(`Unhandled terminal handler: ${name}`)
      }
    }
    return handler(payload) as TerminalClientTestOutputs[keyof TerminalClientTestOutputs]
  }
  // Use the shared `installWebSocketMock` for the WebSocket surface and
  // wrap each new socket's `send` so JSON `request` frames are routed to
  // the matching terminal handler and the response is emitted back over
  // the same socket. This keeps one canonical `MockWebSocket` shape
  // across `src/web/test-utils/`, instead of a second inline copy.
  const socketMock = installWebSocketMock({ autoOpen: true })
  const OriginalSend = socketMock.MockWebSocket.prototype.send
  socketMock.MockWebSocket.prototype.send = function patchedSend(
    this: InstanceType<typeof socketMock.MockWebSocket>,
    data: string,
  ) {
    OriginalSend.call(this, data)
    let parsed: { type?: string; requestId?: string; action?: string; input?: unknown } | null = null
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (parsed?.type !== 'request' || !parsed.requestId || typeof parsed.action !== 'string') return
    const handlerName = terminalHandlerNameForSocketAction(parsed.action)
    if (!handlerName) return
    Promise.resolve()
      .then(() => callTerminalHandler(handlerName, parsed.input))
      .then(
        (payload) => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'response',
              requestId: parsed?.requestId,
              ok: true,
              action: parsed?.action,
              payload,
            }),
          })
        },
        (error) => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'response',
              requestId: parsed?.requestId,
              ok: false,
              action: parsed?.action,
              error: error instanceof Error ? error.message : String(error),
            }),
          })
        },
      )
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      const call = async (name: string, payload: unknown): Promise<unknown> => {
        const handler = handlers[name]
        if (!handler) {
          throw new Error(`Unhandled server route: ${name}`)
        }
        return await handler(payload)
      }
      const openWorkspaceRuntime = async (payload: unknown) => {
        const workspaceId =
          typeof payload === 'object' && payload && 'workspaceId' in payload ? payload.workspaceId : null
        const workspaceInput =
          typeof payload === 'object' && payload && 'workspaceInput' in payload ? payload.workspaceInput : null
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        if (typeof clientId !== 'string' || clientId.length === 0) throw new Error('runtime-open requires clientId')
        if (typeof workspaceInput === 'string' && workspaceInput.length > 0) {
          const probe = (await call('workspace.probe', { workspaceInput })) as WorkspaceSettledProbeState
          if (probe.status === 'unavailable') {
            return {
              ok: false as const,
              input: workspaceInput,
              reason: probe.reason,
            }
          }
          const state = workspaceRuntimeState.get(workspaceInput) ?? {
            currentWorkspaceRuntimeId: null,
            members: new Set<string>(),
          }
          if (!state.currentWorkspaceRuntimeId) state.currentWorkspaceRuntimeId = createOpaqueId('workspace-runtime')
          state.members.add(clientId)
          state.workspaceProbe = {
            status: 'ready',
            capabilities: probe.capabilities,
            diagnostics: probe.diagnostics,
          }
          workspaceRuntimeState.set(workspaceInput, state)
          return {
            ok: true as const,
            workspace: { id: workspaceInput },
            workspaceRuntimeId: state.currentWorkspaceRuntimeId,
            capabilities: probe.capabilities,
            diagnostics: probe.diagnostics,
          }
        }
        if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
          throw new Error('runtime-open requires workspaceId')
        }
        const state = workspaceRuntimeState.get(workspaceId) ?? {
          currentWorkspaceRuntimeId: null,
          members: new Set<string>(),
        }
        const workspaceRuntimeId = state.currentWorkspaceRuntimeId ?? createOpaqueId('workspace-runtime')
        state.currentWorkspaceRuntimeId = workspaceRuntimeId
        state.members.add(clientId)
        workspaceRuntimeState.set(workspaceId, state)
        return { ok: true as const, workspaceRuntimeId }
      }
      const closeWorkspaceRuntime = (payload: unknown) => {
        const workspaceId =
          typeof payload === 'object' && payload && 'workspaceId' in payload ? payload.workspaceId : null
        const workspaceRuntimeId =
          typeof payload === 'object' && payload && 'workspaceRuntimeId' in payload ? payload.workspaceRuntimeId : null
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        if (typeof workspaceId !== 'string' || typeof workspaceRuntimeId !== 'string' || typeof clientId !== 'string') {
          throw new Error('runtime-close requires workspaceId, workspaceRuntimeId, and clientId')
        }
        const state = workspaceRuntimeState.get(workspaceId)
        const released =
          !!state && state.currentWorkspaceRuntimeId === workspaceRuntimeId && state.members.delete(clientId)
        const runtimeClosed = released && !!state && state.members.size === 0
        if (runtimeClosed) state.currentWorkspaceRuntimeId = null
        return { ok: true as const, released, runtimeClosed }
      }
      const reconcileWorkspaceRuntimeMemberships = (payload: unknown) => {
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        const workspaceIds =
          typeof payload === 'object' && payload && 'workspaceIds' in payload ? payload.workspaceIds : null
        if (
          typeof clientId !== 'string' ||
          !Array.isArray(workspaceIds) ||
          !workspaceIds.every((workspaceId) => typeof workspaceId === 'string')
        ) {
          throw new Error('runtime-reconcile requires clientId and workspaceIds')
        }
        const desired = new Set(workspaceIds)
        for (const [workspaceId, state] of workspaceRuntimeState) {
          if (desired.has(workspaceId)) continue
          state.members.delete(clientId)
          if (state.members.size === 0) state.currentWorkspaceRuntimeId = null
        }
        return {
          runtimes: workspaceIds.map((workspaceId) => {
            const state = workspaceRuntimeState.get(workspaceId) ?? {
              currentWorkspaceRuntimeId: null,
              members: new Set<string>(),
            }
            state.currentWorkspaceRuntimeId ??= createOpaqueId('workspace-runtime')
            state.members.add(clientId)
            workspaceRuntimeState.set(workspaceId, state)
            return {
              workspaceId,
              workspaceRuntimeId: state.currentWorkspaceRuntimeId,
              workspaceProbe: state.workspaceProbe ?? { status: 'probing' },
              ...(state.remoteLifecycle ? { remoteLifecycle: state.remoteLifecycle } : {}),
            }
          }),
        }
      }
      const listWorkspaceRuntimes = () => ({
        runtimes: Array.from(workspaceRuntimeState.entries()).flatMap(([workspaceId, state]) =>
          state.currentWorkspaceRuntimeId
            ? [
                {
                  workspaceId,
                  workspaceRuntimeId: state.currentWorkspaceRuntimeId,
                  workspaceProbe: state.workspaceProbe ?? { status: 'probing' },
                  ...(state.remoteLifecycle ? { remoteLifecycle: state.remoteLifecycle } : {}),
                },
              ]
            : [],
        ),
      })
      const result = (() => {
        if (url.pathname === '/api/settings') return call('settings.get', undefined)
        if (url.pathname === '/api/i18n') return call('i18n.get', undefined)
        if (url.pathname === '/api/settings/github-cli') return call('githubCli.get', body)
        if (url.pathname === '/api/settings/github-cli/refresh') return call('githubCli.refresh', body)
        if (url.pathname === '/api/settings/external-apps') {
          return init?.method === 'POST' ? call('externalApps.refresh', body) : call('externalApps.get', undefined)
        }
        if (url.pathname === '/api/settings/recent-workspaces/add') return call('settings.addRecentWorkspace', body)
        if (url.pathname === '/api/settings/workspace/restore') return call('settings.restoreWorkspace', body)
        if (url.pathname === '/api/settings/workspace/entries/add') return call('settings.addWorkspaceEntry', body)
        if (url.pathname === '/api/settings/workspace/entries/remove')
          return call('settings.removeWorkspaceEntry', body)
        if (url.pathname === '/api/settings/fetch-interval') return call('settings.setFetchInterval', body)
        if (url.pathname === '/api/settings/prefs') return call('settings.updateUserSettings', body)
        if (url.pathname === '/api/remote/ssh-hosts') return call('remote.listSshHosts', undefined)
        if (url.pathname === '/api/remote/resolve-target') return call('remote.resolveTarget', body)
        if (url.pathname === '/api/remote/lifecycle') {
          return Promise.resolve(call('remote.lifecycle', body)).then((result) => {
            const value = result as {
              kind?: string
              workspaceId?: string
              lifecycle?: RemoteWorkspaceRuntimeLifecycle
              workspaceProbe?: WorkspaceProbeState
            }
            if (value.kind === 'settled' && value.workspaceId && value.lifecycle && value.workspaceProbe) {
              const requestedRuntimeId =
                typeof body.workspaceRuntimeId === 'string' ? body.workspaceRuntimeId : createOpaqueId('repo-runtime')
              const state = workspaceRuntimeState.get(value.workspaceId) ?? {
                currentWorkspaceRuntimeId: requestedRuntimeId,
                members: new Set<string>(),
              }
              workspaceRuntimeState.set(value.workspaceId, state)
              if (state.currentWorkspaceRuntimeId === requestedRuntimeId) {
                state.remoteLifecycle = value.lifecycle
                state.workspaceProbe = value.workspaceProbe
              }
            }
            return result
          })
        }
        if (url.pathname === '/api/remote/path-suggestions') return call('remote.listPathSuggestions', body)
        if (url.pathname === '/api/remote/test-workspace') return call('remote.testWorkspace', body)
        if (url.pathname === '/api/repo/log') return call('repo.log', body)
        if (url.pathname === '/api/repo/remote-branches') return call('repo.remoteBranches', body)
        if (url.pathname === '/api/repo/snapshot') return call('repo.snapshot', body)
        if (url.pathname === '/api/repo/pull-requests') return call('repo.pullRequests', body)
        if (url.pathname === '/api/repo/worktree-status') {
          return handlers['repo.worktreeStatus']
            ? call('repo.worktreeStatus', body)
            : { workspaceRuntimeId: body.workspaceRuntimeId, status: [], loadedAt: Date.now() }
        }
        if (url.pathname === '/api/repo/operations') {
          return handlers['repo.operations'] ? call('repo.operations', body) : { operations: [], loadedAt: Date.now() }
        }
        if (url.pathname === '/api/repo/patch') return call('repo.patch', body)
        if (url.pathname === '/api/repo/fetch') return call('repo.fetch', body)
        if (url.pathname === '/api/repo/clone') return call('repo.clone', body)
        if (url.pathname === '/api/repo/pull') return call('repo.pull', body)
        if (url.pathname === '/api/repo/push') return call('repo.push', body)
        if (url.pathname === '/api/repo/create-worktree') return call('repo.createWorktree', body)
        if (url.pathname === '/api/repo/worktree-bootstrap-preview') return call('repo.worktreeBootstrapPreview', body)
        if (url.pathname === '/api/repo/delete-branch') return call('repo.deleteBranch', body)
        if (url.pathname === '/api/repo/remove-worktree') return call('repo.removeWorktree', body)
        if (url.pathname === '/api/repo/open-url') return call('repo.openUrl', body)
        if (url.pathname === '/api/repo/background-sync-repos') return call('repo.backgroundSyncRepos', body)
        if (url.pathname === '/api/workspace/runtime-open') {
          return handlers['workspace.runtimeOpen'] ? call('workspace.runtimeOpen', body) : openWorkspaceRuntime(body)
        }
        if (url.pathname === '/api/workspace/tree') return call('workspace.tree', body)
        if (url.pathname === '/api/workspace/trash-file') return call('workspace.trashFile', body)
        if (url.pathname === '/api/workspace/file-viewer') return call('workspace.fileViewer', body)
        if (url.pathname === '/api/workspace/open-terminal') return call('workspace.openTerminal', body)
        if (url.pathname === '/api/workspace/open-editor') return call('workspace.openEditor', body)
        if (url.pathname === '/api/workspace/open-in-finder') return call('workspace.openInFinder', body)
        if (url.pathname === '/api/workspace/runtime-list') {
          return handlers['workspace.runtimeList'] ? call('workspace.runtimeList', body) : listWorkspaceRuntimes()
        }
        if (url.pathname === '/api/workspace/runtime-reconcile') {
          return handlers['workspace.runtimeReconcile']
            ? call('workspace.runtimeReconcile', body)
            : reconcileWorkspaceRuntimeMemberships(body)
        }
        if (url.pathname === '/api/workspace/runtime-close') {
          return handlers['workspace.runtimeClose'] ? call('workspace.runtimeClose', body) : closeWorkspaceRuntime(body)
        }
        if (url.pathname === '/api/workspace/refresh') {
          return handlers['workspace.refresh']
            ? call('workspace.refresh', body)
            : {
                kind: 'committed',
                probe: {
                  status: 'ready',
                  capabilities: {
                    files: { read: true, write: true },
                    terminal: { available: true },
                    git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
                  },
                  diagnostics: [],
                },
              }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      })()
      const abortError = () => {
        if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError')
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        return err
      }
      const withAbort = async <T>(value: T | Promise<T>): Promise<T> => {
        const signal = init?.signal
        if (!signal) return await value
        if (signal.aborted) throw abortError()
        return await new Promise<T>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort)
            reject(abortError())
          }
          signal.addEventListener('abort', onAbort, { once: true })
          Promise.resolve(value).then(
            (resolved) => {
              signal.removeEventListener('abort', onAbort)
              resolve(resolved)
            },
            (err) => {
              signal.removeEventListener('abort', onAbort)
              reject(err)
            },
          )
        })
      }
      try {
        const resolved = await withAbort(result)
        return {
          ok: true,
          status: 200,
          json: async () => resolved,
        }
      } catch (error) {
        if (hasErrorCode(error, 'OUTCOME_UNCERTAIN')) throw error
        return {
          ok: false,
          status: 500,
          json: async () => ({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }),
        }
      }
    }),
  )
}
