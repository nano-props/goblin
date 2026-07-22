// Preload bridge. Exposes low-level IPC under `window.goblinNative` to the
// client. The client no longer needs a bootstrap roundtrip here — the
// server renders the full bootstrap JSON into the HTML response
// (`<script id="goblin-bootstrap">`), which is read by `web/bootstrap.ts`
// after page load. The preload is now strictly an IPC bridge: every
// function it exposes corresponds to a capability that the client
// could not get from the server (open settings window, send IPC
// requests to main, etc.).
//
// IMPORTANT: This preload runs with sandbox: true (see window.ts). Only
// the `electron` module is available here — do NOT require Node built-ins
// like `os`, `fs`, or `path`, and do NOT require `pino` / `consola`.
// The `console.warn` calls below are intentionally raw: in sandboxed
// preload we have no structured logger available, and these errors are
// only visible in DevTools where the client-side `web/logger.ts` will
// already be emitting its own (more detailed) records.
const { contextBridge, ipcRenderer, webUtils } = require('electron')
const IPC = {
  ipc: {
    call: 'goblin:ipc',
    abort: 'goblin:ipc-abort',
    event: 'goblin:event',
    effectIntent: 'goblin:client-effect-intent',
    appQuitDrained: 'goblin:app-quit-drained',
  },
  host: {
    openSettingsWindow: 'goblin:host-open-settings-window',
    openExternalUrl: 'goblin:host-open-external-url',
    openDirectoryDialog: 'goblin:host-open-directory-dialog',
    consumeExternalOpenPaths: 'goblin:host-consume-external-open-paths',
  },
  terminal: {
    notifyBell: 'goblin:terminal-notify-bell',
    sendTestNotification: 'goblin:terminal-send-test-notification',
    setBadge: 'goblin:terminal-set-badge',
  },
  accessToken: {
    rotate: 'goblin:rotate-access-token',
  },
}

// `ipcRenderer.invoke` rejects when the main handler throws. We log the
// channel once at the bridge, then rethrow so client call sites can
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

const ipcEventSubscribers = new Set()
let ipcEventListener = null

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

const effectIntentSubscribers = new Set()
let effectIntentListener = null

function ensureEffectIntentListener() {
  if (effectIntentListener) return
  effectIntentListener = (_event, payload) => {
    for (const cb of effectIntentSubscribers) {
      try {
        cb(payload)
      } catch (err) {
        console.warn('[ipc] goblin:client-effect-intent subscriber failed', err)
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
  invokeIpc: ({ path, input, requestId }) => ipcCall({ path, input, requestId }),
  abortIpc: (requestId) => safeInvoke(IPC.ipc.abort, { requestId }),
  notifyAppQuitDrained: (result) => safeInvoke(IPC.ipc.appQuitDrained, result),
  pathForFile: (file) => webUtils.getPathForFile(file),
  host: {
    openSettingsWindow: (input) => safeInvoke(IPC.host.openSettingsWindow, input),
    openExternalUrl: (input) => safeInvoke(IPC.host.openExternalUrl, input),
    openDirectoryDialog: (input) => safeInvoke(IPC.host.openDirectoryDialog, input),
    consumeExternalOpenPaths: () => safeInvoke(IPC.host.consumeExternalOpenPaths),
  },
  terminal: {
    notifyBell: (input) => safeInvoke(IPC.terminal.notifyBell, input),
    sendTestNotification: (input) => safeInvoke(IPC.terminal.sendTestNotification, input),
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
  rotateAccessToken: () => safeInvoke(IPC.accessToken.rotate),
  onIntent: (cb) => {
    effectIntentSubscribers.add(cb)
    ensureEffectIntentListener()
    return () => {
      effectIntentSubscribers.delete(cb)
      maybeDisposeEffectIntentListener()
    }
  },
})

// Auth model: the client is identical in every runtime. The
// embedded Electron main plants the auth cookie on the client's
// `webContents.session` BEFORE the URL loads, so the client's
// first request (the `useAccessTokenStatus` whoami probe) already
// carries the cookie and clears the gate without user input. The
// web path skips the gate entirely — the user pastes the token
// once and `useAccessTokenStatus` exchanges it for the same
// cookie. After that, both paths look identical: the client
// calls `fetchServerJson('/api/whoami')`, the browser attaches
// the cookie, the server returns 200.
//
// The preload does NOT seed `window.__GOBLIN_BOOTSTRAP__` with
// anything — the bootstrap is empty on first paint in every
// runtime, and the client fetches i18n before mounting the normal
// app tree, then fetches host info and settings from the dedicated
// `/api/*` endpoints during the app bootstrap hooks. The embedded
// path used to also seed
// homeDir + platform via `goblin:get-home-dir` /
// `goblin:get-platform` IPC; those channels were removed when
// host info moved to the public `/api/host` endpoint, so the
// preload is now strictly an IPC bridge for browser-missing
// capabilities (open settings window, send IPC requests, etc.).
