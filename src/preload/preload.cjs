// Preload bridge. Exposes low-level IPC under `window.goblinNative` to the renderer.
// IMPORTANT: This preload runs with sandbox: true (see window.ts). Only
// the `electron` module is available here — do NOT require Node built-ins
// like `os`, `fs`, or `path`, and do NOT require `pino` / `consola`.
// The `console.warn` calls below are intentionally raw: in sandboxed
// preload we have no structured logger available, and these errors are
// only visible in DevTools where the renderer-side `web/logger.ts` will
// already be emitting its own (more detailed) records.
const { contextBridge, ipcRenderer, webUtils } = require('electron')
const IPC = {
  ipc: {
    call: 'goblin:ipc',
    abort: 'goblin:ipc-abort',
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
  bootstrap: {
    get: 'goblin:get-bootstrap',
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

function ipcCall(request) {
  return safeInvoke(IPC.ipc.call, request)
    .then((response) => {
      if (!isObject(response) || typeof response.ok !== 'boolean') throw new Error('Malformed IPC response')
      if (response.ok) return response.data
      const error = isObject(response.error) ? response.error : null
      throw Object.assign(new Error(typeof error?.message === 'string' ? error.message : 'IPC request failed'), {
        name: typeof error?.name === 'string' ? error.name : 'IpcError',
        code: typeof error?.code === 'string' ? error.code : undefined,
      })
    })
    .catch((err) => {
      console.warn(`[ipc] ${request.path} failed`, err)
      throw err
    })
}

// A short `--goblin-bootstrap-token=...` is injected by main via
// webPreferences.additionalArguments (see window-shell.ts). Keep the actual
// bootstrap payload off the renderer command line: Windows has a much lower
// process command-line limit than macOS, and a full base64 payload can make
// Chromium fail to launch the renderer process before page scripts run.
function safeReadBootstrapArgument() {
  const token =
    process.argv.find((a) => a.startsWith(BOOTSTRAP_TOKEN_PREFIX))?.slice(BOOTSTRAP_TOKEN_PREFIX.length) ?? ''
  if (!token) return null
  try {
    return ipcRenderer.sendSync(IPC.bootstrap.get, token)
  } catch (err) {
    console.warn('[preload] failed to read bootstrap payload', err)
    return null
  }
}

const BOOTSTRAP_TOKEN_PREFIX = '--goblin-bootstrap-token='
const bootstrap = safeReadBootstrapArgument()
const runtime =
  isObject(bootstrap?.runtime) &&
  (bootstrap.runtime.kind === 'electron' || bootstrap.runtime.kind === 'web') &&
  typeof bootstrap.runtime.bridgeVersion === 'number' &&
  Array.isArray(bootstrap.runtime.capabilities) &&
  bootstrap.runtime.capabilities.every((value) => typeof value === 'string')
    ? bootstrap.runtime
    : { kind: 'electron', bridgeVersion: 1, capabilities: [] }
const homeDir = typeof bootstrap?.homeDir === 'string' ? bootstrap.homeDir : ''
/**
 * Host platform. The renderer is sandboxed and does not have `process`
 * at runtime, so we surface the platform from the bootstrap payload main
 * hands us. The list mirrors NodeJS.Platform plus 'web' (used when the
 * renderer runs outside Electron, e.g. the dev server).
 */
const KNOWN_RENDERER_PLATFORMS = new Set([
  'aix',
  'android',
  'cygwin',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'netbsd',
  'openbsd',
  'sunos',
  'win32',
  'web',
])
const platform =
  typeof bootstrap?.platform === 'string' && KNOWN_RENDERER_PLATFORMS.has(bootstrap.platform)
    ? bootstrap.platform
    : 'web'
const initialI18n = isObject(bootstrap?.i18n) ? bootstrap.i18n : null
const initialSettings = isObject(bootstrap?.settings) ? bootstrap.settings : null
const initialServer =
  isObject(bootstrap?.server) &&
  typeof bootstrap.server.url === 'string' &&
  typeof bootstrap.server.secret === 'string' &&
  (typeof bootstrap.server.clientId === 'undefined' || typeof bootstrap.server.clientId === 'string')
    ? bootstrap.server
    : null
const ipcEventSubscribers = new Set()
let ipcEventListener = null
const effectIntentSubscribers = new Set()
let effectIntentListener = null

function ensureIpcEventListener() {
  if (ipcEventListener) return
  ipcEventListener = (_event, payload) => {
    for (const cb of ipcEventSubscribers) {
      try {
        cb(payload)
      } catch (err) {
        console.warn('[ipc] goblin:event subscriber failed', err)
      }
    }
  }
  ipcRenderer.on(IPC.ipc.event, ipcEventListener)
}

function maybeDisposeIpcEventListener() {
  if (ipcEventSubscribers.size > 0 || !ipcEventListener) return
  ipcRenderer.off(IPC.ipc.event, ipcEventListener)
  ipcEventListener = null
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
  ipcRenderer.on(IPC.ipc.effectIntent, effectIntentListener)
}

function maybeDisposeEffectIntentListener() {
  if (effectIntentSubscribers.size > 0 || !effectIntentListener) return
  ipcRenderer.off(IPC.ipc.effectIntent, effectIntentListener)
  effectIntentListener = null
}

contextBridge.exposeInMainWorld('goblinNative', {
  runtime,
  homeDir,
  platform,
  initialI18n,
  initialSettings,
  initialServer,
  invokeIpc: ({ path, input, requestId }) => ipcCall({ path, input, requestId }),
  abortIpc: (requestId) => safeInvoke(IPC.ipc.abort, { requestId }),
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
    ipcEventSubscribers.add(cb)
    ensureIpcEventListener()
    return () => {
      ipcEventSubscribers.delete(cb)
      maybeDisposeIpcEventListener()
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
