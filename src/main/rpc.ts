import { ipcMain } from 'electron'
import { AsyncLocalStorage } from 'node:async_hooks'
import { RpcError, createAppRouter, type AppRpcHandlers, type RpcRequest, type RpcResponse } from '#/shared/rpc.ts'
import { applyMainWindowChromeTheme } from '#/main/window.ts'
import { allRegisteredSurfacesWithCapability } from '#/main/window-registry.ts'
import { subscribeTheme } from '#/main/theme.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { broadcastRpcEvent } from '#/main/events.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'
import { RPC_ABORT_CHANNEL, RPC_CHANNEL } from '#/shared/ipc-channels.ts'
import {
  createEmbeddedServerRemoteRpcProxyHandlers,
  createEmbeddedServerRepoRpcProxyHandlers,
} from '#/main/embedded-server-rpc-proxy.ts'
import { createNativeRpcHandlers } from '#/main/native-rpc-handlers.ts'

const MAX_RPC_PROCEDURE_PATH_LENGTH = 128
const MAX_RPC_REQUEST_ID_LENGTH = 128
const RPC_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/
const RPC_REQUEST_ID_RE = /^[A-Za-z0-9_-]+$/
const FORBIDDEN_RPC_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const activeRpcControllers = new Map<string, AbortController>()
const rpcSignalStorage = new AsyncLocalStorage<AbortSignal>()

let wired = false

export function wireRpcIpc(): void {
  if (wired) return
  wired = true

  const router = createAppRouter(createRpcHandlers())

  ipcMain.handle(RPC_ABORT_CHANNEL, async (event, input: unknown): Promise<boolean> => {
    try {
      return isTrustedIpcEvent(event) ? abortRpcRequest(input) : false
    } catch {
      return false
    }
  })

  ipcMain.handle(RPC_CHANNEL, async (event, request: RpcRequest): Promise<RpcResponse> => {
    try {
      if (!isTrustedIpcEvent(event)) {
        throw new RpcError({ code: 'FORBIDDEN', message: 'Untrusted IPC sender' })
      }
      if (!isValidRpcRequest(request)) {
        throw new RpcError({ code: 'BAD_REQUEST', message: 'Invalid RPC request' })
      }
      const caller = router.createCaller()
      const procedure = request.path.split('.').reduce<unknown>(resolveRpcPathSegment, caller)
      if (typeof procedure !== 'function') {
        throw new RpcError({ code: 'NOT_FOUND', message: `Unknown RPC procedure: ${request.path}` })
      }
      const requestId = request.requestId
      if (!isValidRpcRequestId(requestId)) return { ok: true, data: await procedure(request.input) }
      const ctrl = new AbortController()
      activeRpcControllers.set(requestId, ctrl)
      try {
        const data = await rpcSignalStorage.run(ctrl.signal, () => procedure(request.input))
        return { ok: true, data }
      } finally {
        if (activeRpcControllers.get(requestId) === ctrl) activeRpcControllers.delete(requestId)
      }
    } catch (err) {
      return { ok: false, error: toRpcError(err) }
    }
  })

  subscribeTheme((state) => {
    for (const { window: win } of allRegisteredSurfacesWithCapability('themeSync')) {
      if (!win.isDestroyed()) win.setBackgroundColor(WINDOW_BACKGROUND_BY_COLOR_THEME[state.colorTheme][state.resolved])
    }
    applyMainWindowChromeTheme(state.resolved)
    buildAppMenu()
    broadcastRpcEvent({ type: 'theme-changed', state })
  })
}

function isValidRpcRequest(request: unknown): request is RpcRequest {
  if (!request || typeof request !== 'object') return false
  const { path } = request as { path?: unknown }
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_RPC_PROCEDURE_PATH_LENGTH) return false
  const segments = path.split('.')
  if (segments.some((segment) => segment.length === 0)) return false
  if (!segments.every((segment) => RPC_PATH_SEGMENT_RE.test(segment) && !FORBIDDEN_RPC_PATH_SEGMENTS.has(segment))) {
    return false
  }
  return true
}

function isValidRpcRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RPC_REQUEST_ID_LENGTH &&
    RPC_REQUEST_ID_RE.test(value)
  )
}

function abortRpcRequest(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const { requestId } = input as { requestId?: unknown }
  if (!isValidRpcRequestId(requestId)) return false
  const ctrl = activeRpcControllers.get(requestId)
  if (!ctrl) return false
  ctrl.abort()
  return true
}

function currentRpcSignal(): AbortSignal | undefined {
  return rpcSignalStorage.getStore()
}

function resolveRpcPathSegment(target: unknown, segment: string): unknown {
  if (FORBIDDEN_RPC_PATH_SEGMENTS.has(segment)) return undefined
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return undefined
  return (target as Record<string, unknown>)[segment]
}

function toRpcError(err: unknown): Extract<RpcResponse, { ok: false }>['error'] {
  if (err instanceof RpcError) return { name: err.name, code: err.code, message: err.message }
  if (err instanceof Error) return { name: err.name, message: err.message }
  return { message: String(err) }
}

function createRpcHandlers(): AppRpcHandlers {
  return {
    repo: createEmbeddedServerRepoRpcProxyHandlers(currentRpcSignal),
    remote: createEmbeddedServerRemoteRpcProxyHandlers(currentRpcSignal),
    ...createNativeRpcHandlers({ currentRpcSignal }),
  }
}
