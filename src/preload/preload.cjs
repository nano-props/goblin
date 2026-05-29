// Preload bridge. Exposes low-level IPC under `window.goblin` to the renderer.
// IMPORTANT: This preload runs with sandbox: true (see window.ts). Only
// the `electron` module is available here — do NOT require Node built-ins
// like `os`, `fs`, or `path`. Anything that needs Node lives
// in the main process and is reached via IPC.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

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
  return safeInvoke('goblin:rpc', request)
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

// `--gbl-home-dir=...` is injected by main via webPreferences.additionalArguments
// (see window.ts). `process.argv` is one of the few things sandbox-safe
// preloads can still read, which is why we use it here instead of
// `os.homedir()` or a sync IPC.
const HOME_PREFIX = '--gbl-home-dir='
const homeDir = process.argv.find((a) => a.startsWith(HOME_PREFIX))?.slice(HOME_PREFIX.length) ?? ''

contextBridge.exposeInMainWorld('goblin', {
  homeDir,
  invokeRpc: ({ path, input, requestId }) => rpcCall({ path, input, requestId }),
  abortRpc: (requestId) => safeInvoke('goblin:rpc-abort', { requestId }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  terminal: {
    open: (input) => safeInvoke('goblin:terminal-open', input),
    restart: (input) => safeInvoke('goblin:terminal-restart', input),
    write: (input) => safeInvoke('goblin:terminal-write', input),
    resize: (input) => safeInvoke('goblin:terminal-resize', input),
    close: (input) => safeInvoke('goblin:terminal-close', input),
    pruneRepo: (input) => safeInvoke('goblin:terminal-prune-repo', input),
    notifyBell: (input) => safeInvoke('goblin:terminal-notify-bell', input),
    onOutput: (cb) => {
      const listener = (_event, payload) => cb(payload)
      ipcRenderer.on('goblin:terminal-output', listener)
      return () => ipcRenderer.off('goblin:terminal-output', listener)
    },
    onExit: (cb) => {
      const listener = (_event, payload) => cb(payload)
      ipcRenderer.on('goblin:terminal-exit', listener)
      return () => ipcRenderer.off('goblin:terminal-exit', listener)
    },
  },
  onEvent: (cb) => {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on('goblin:event', listener)
    return () => ipcRenderer.off('goblin:event', listener)
  },
})
