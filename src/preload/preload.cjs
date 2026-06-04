// Preload bridge. Exposes low-level IPC under `window.goblinNative` to the renderer.
// IMPORTANT: This preload runs with sandbox: true (see window.ts). Only
// the `electron` module is available here — do NOT require Node built-ins
// like `os`, `fs`, or `path`. Anything that needs Node lives
// in the main process and is reached via IPC.
const { contextBridge, ipcRenderer, webUtils } = require('electron')
const IPC = {
  rpc: {
    call: 'goblin:rpc',
    abort: 'goblin:rpc-abort',
    event: 'goblin:event',
    effectIntent: 'goblin:effect-intent',
  },
  shell: {
    openSettingsWindow: 'goblin:shell-open-settings-window',
    openExternalUrl: 'goblin:shell-open-external-url',
    openDirectoryDialog: 'goblin:shell-open-directory-dialog',
    consumeExternalOpenPaths: 'goblin:shell-consume-external-open-paths',
    openInFinder: 'goblin:shell-open-in-finder',
  },
  terminal: {
    notifyBell: 'goblin:terminal-notify-bell',
    sendTestNotification: 'goblin:terminal-send-test-notification',
    setBadge: 'goblin:terminal-set-badge',
  },
}

// `ipcRenderer.invoke` rejects when the main handler throws. We log the
// channel once at the bridge, then rethrow so renderer call sites can
// decide whether to surface a toast, fall back, or intentionally ignore
// the failure with their own `.catch()`.
function safeInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    console.warn(`[ipc] ${channel} failed`, err)
    throw err
  })
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function rpcCall(request) {
  return safeInvoke(IPC.rpc.call, request)
    .then((response) => {
      if (!isObject(response) || typeof response.ok !== 'boolean') throw new Error('Malformed RPC response')
      if (response.ok) return response.data
      const error = isObject(response.error) ? response.error : null
      throw Object.assign(new Error(typeof error?.message === 'string' ? error.message : 'RPC request failed'), {
        name: typeof error?.name === 'string' ? error.name : 'RpcError',
        code: typeof error?.code === 'string' ? error.code : undefined,
      })
    })
    .catch((err) => {
      console.warn(`[rpc] ${request.path} failed`, err)
      throw err
    })
}

// `--goblin-bootstrap=...` is injected by main via
// webPreferences.additionalArguments (see window-shell.ts).
// `process.argv` is one of the few things sandbox-safe preloads can still
// read, which is why we use it here instead of sync IPC.
function safeParseBase64JsonArgument(prefix, label) {
  const raw = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? ''
  if (!raw) return null
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch (err) {
    console.warn(`[preload] failed to parse ${label}`, err)
    return null
  }
}

const BOOTSTRAP_PREFIX = '--goblin-bootstrap='
const bootstrap = safeParseBase64JsonArgument(BOOTSTRAP_PREFIX, 'bootstrap payload')
const runtime =
  isObject(bootstrap?.runtime) &&
  (bootstrap.runtime.kind === 'electron' || bootstrap.runtime.kind === 'web') &&
  typeof bootstrap.runtime.bridgeVersion === 'number' &&
  Array.isArray(bootstrap.runtime.capabilities) &&
  bootstrap.runtime.capabilities.every((value) => typeof value === 'string')
    ? bootstrap.runtime
    : { kind: 'electron', bridgeVersion: 1, capabilities: [] }
const homeDir = typeof bootstrap?.homeDir === 'string' ? bootstrap.homeDir : ''
const initialI18n = isObject(bootstrap?.i18n) ? bootstrap.i18n : null
const initialSettings = isObject(bootstrap?.settings) ? bootstrap.settings : null
const initialServer =
  isObject(bootstrap?.server) &&
  typeof bootstrap.server.url === 'string' &&
  typeof bootstrap.server.secret === 'string' &&
  (typeof bootstrap.server.clientId === 'undefined' || typeof bootstrap.server.clientId === 'string')
    ? bootstrap.server
    : null
const rpcEventSubscribers = new Set()
let rpcEventListener = null
const effectIntentSubscribers = new Set()
let effectIntentListener = null

function ensureRpcEventListener() {
  if (rpcEventListener) return
  rpcEventListener = (_event, payload) => {
    for (const cb of rpcEventSubscribers) {
      try {
        cb(payload)
      } catch (err) {
        console.warn('[ipc] goblin:event subscriber failed', err)
      }
    }
  }
  ipcRenderer.on(IPC.rpc.event, rpcEventListener)
}

function maybeDisposeRpcEventListener() {
  if (rpcEventSubscribers.size > 0 || !rpcEventListener) return
  ipcRenderer.off(IPC.rpc.event, rpcEventListener)
  rpcEventListener = null
}

function ensureEffectIntentListener() {
  if (effectIntentListener) return
  effectIntentListener = (_event, payload) => {
    for (const cb of effectIntentSubscribers) {
      try {
        cb(payload)
      } catch (err) {
        console.warn('[ipc] goblin:effect-intent subscriber failed', err)
      }
    }
  }
  ipcRenderer.on(IPC.rpc.effectIntent, effectIntentListener)
}

function maybeDisposeEffectIntentListener() {
  if (effectIntentSubscribers.size > 0 || !effectIntentListener) return
  ipcRenderer.off(IPC.rpc.effectIntent, effectIntentListener)
  effectIntentListener = null
}

contextBridge.exposeInMainWorld('goblinNative', {
  runtime,
  homeDir,
  initialI18n,
  initialSettings,
  initialServer,
  invokeRpc: ({ path, input, requestId }) => rpcCall({ path, input, requestId }),
  abortRpc: (requestId) => safeInvoke(IPC.rpc.abort, { requestId }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  shell: {
    openSettingsWindow: (input) => safeInvoke(IPC.shell.openSettingsWindow, input),
    openExternalUrl: (input) => safeInvoke(IPC.shell.openExternalUrl, input),
    openDirectoryDialog: (input) => safeInvoke(IPC.shell.openDirectoryDialog, input),
    consumeExternalOpenPaths: () => safeInvoke(IPC.shell.consumeExternalOpenPaths),
    openInFinder: (input) => safeInvoke(IPC.shell.openInFinder, input),
  },
  terminal: {
    notifyBell: (input) => safeInvoke(IPC.terminal.notifyBell, input),
    sendTestNotification: () => safeInvoke(IPC.terminal.sendTestNotification),
    setBadge: (count) => {
      ipcRenderer.send(IPC.terminal.setBadge, count)
    },
  },
  onEvent: (cb) => {
    rpcEventSubscribers.add(cb)
    ensureRpcEventListener()
    return () => {
      rpcEventSubscribers.delete(cb)
      maybeDisposeRpcEventListener()
    }
  },
  onIntent: (cb) => {
    effectIntentSubscribers.add(cb)
    ensureEffectIntentListener()
    return () => {
      effectIntentSubscribers.delete(cb)
      maybeDisposeEffectIntentListener()
    }
  },
})
