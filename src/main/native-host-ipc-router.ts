import { ipcMain } from 'electron'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  IpcError,
  createAppRouter,
  type NativeHostIpcHandlers,
  type IpcRequest,
  type IpcResponse,
} from '#/shared/api-types.ts'
import { NATIVE_HOST_IPC_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import { applyPrimaryWindowTitleBarTheme } from '#/main/window.ts'
import { allRegisteredSurfacesWithCapability } from '#/main/client-surface-registry.ts'
import { subscribeTheme } from '#/main/theme.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'
import { HOST_IPC_ABORT_CHANNEL, HOST_IPC_CALL_CHANNEL } from '#/shared/ipc-channels.ts'
import { createNativeHostIpcHandlers } from '#/main/native-host-ipc-handlers.ts'

const MAX_IPC_PROCEDURE_PATH_LENGTH = 128
const MAX_IPC_REQUEST_ID_LENGTH = 128
const IPC_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/
const IPC_REQUEST_ID_RE = /^[A-Za-z0-9_-]+$/
const FORBIDDEN_IPC_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const activeIpcControllers = new Map<string, AbortController>()
const ipcSignalStorage = new AsyncLocalStorage<AbortSignal>()

let wired = false

export function wireIpc(): void {
  if (wired) return
  wired = true

  const router = createAppRouter(createNativeHostIpcHandlers(), NATIVE_HOST_IPC_PROCEDURE_SCHEMAS)

  ipcMain.handle(HOST_IPC_ABORT_CHANNEL, async (event, input: unknown): Promise<boolean> => {
    try {
      return isTrustedIpcEvent(event) ? abortIpcRequest(input) : false
    } catch {
      return false
    }
  })

  ipcMain.handle(HOST_IPC_CALL_CHANNEL, async (event, request: IpcRequest): Promise<IpcResponse> => {
    try {
      if (!isTrustedIpcEvent(event)) {
        throw new IpcError({ code: 'FORBIDDEN', message: 'Untrusted IPC sender' })
      }
      if (!isValidIpcRequest(request)) {
        throw new IpcError({ code: 'BAD_REQUEST', message: 'Invalid IPC request' })
      }
      const caller = router.createCaller()
      const procedure = request.path.split('.').reduce<unknown>(resolveIpcPathSegment, caller)
      if (typeof procedure !== 'function') {
        throw new IpcError({ code: 'NOT_FOUND', message: `Unknown IPC procedure: ${request.path}` })
      }
      const requestId = request.requestId
      if (!isValidIpcRequestId(requestId)) return { ok: true, data: await procedure(request.input) }
      const ctrl = new AbortController()
      activeIpcControllers.set(requestId, ctrl)
      try {
        const data = await ipcSignalStorage.run(ctrl.signal, () => procedure(request.input))
        return { ok: true, data }
      } finally {
        if (activeIpcControllers.get(requestId) === ctrl) activeIpcControllers.delete(requestId)
      }
    } catch (err) {
      return { ok: false, error: toIpcError(err) }
    }
  })

  subscribeTheme((state) => {
    for (const { window: win } of allRegisteredSurfacesWithCapability('themeSync')) {
      if (!win.isDestroyed()) win.setBackgroundColor(WINDOW_BACKGROUND_BY_COLOR_THEME[state.colorTheme][state.resolved])
    }
    applyPrimaryWindowTitleBarTheme(state.resolved)
    buildAppMenu()
  })
}

function isValidIpcRequest(request: unknown): request is IpcRequest {
  if (!request || typeof request !== 'object') return false
  const { path } = request as { path?: unknown }
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_IPC_PROCEDURE_PATH_LENGTH) return false
  const segments = path.split('.')
  if (segments.some((segment) => segment.length === 0)) return false
  if (!segments.every((segment) => IPC_PATH_SEGMENT_RE.test(segment) && !FORBIDDEN_IPC_PATH_SEGMENTS.has(segment))) {
    return false
  }
  return true
}

function isValidIpcRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_IPC_REQUEST_ID_LENGTH &&
    IPC_REQUEST_ID_RE.test(value)
  )
}

function abortIpcRequest(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const { requestId } = input as { requestId?: unknown }
  if (!isValidIpcRequestId(requestId)) return false
  const ctrl = activeIpcControllers.get(requestId)
  if (!ctrl) return false
  ctrl.abort()
  return true
}

function resolveIpcPathSegment(target: unknown, segment: string): unknown {
  if (FORBIDDEN_IPC_PATH_SEGMENTS.has(segment)) return undefined
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return undefined
  return (target as Record<string, unknown>)[segment]
}

function toIpcError(err: unknown): Extract<IpcResponse, { ok: false }>['error'] {
  if (err instanceof IpcError) return { name: err.name, code: err.code, message: err.message }
  if (err instanceof Error) return { name: err.name, message: err.message }
  return { message: String(err) }
}
