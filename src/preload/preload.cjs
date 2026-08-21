// Exposes native-only capabilities under `window.goblinNative`.
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
    effectIntent: 'goblin:client-effect-intent',
    effectIntentChallenge: 'goblin:client-effect-intent-challenge',
    effectIntentReady: 'goblin:client-effect-intent-ready',
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
    projection: 'goblin:get-access-token-projection',
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
        name: typeof error?.name === 'string' ? error.name : 'Error',
        code: typeof error?.code === 'string' ? error.code : undefined,
      })
    })
    .catch((err) => {
      console.warn(`[ipc] ${request.path} failed`, err)
      throw err
    })
}

let effectIntentConsumer = null
const queuedEffectIntents = []
let externalOpenWakeupQueued = false
let appQuittingConsumer = null
let appQuittingQueued = false

// Main may finish loading the window before the Vue intent router mounts.
// Listen for native intents for the entire preload lifetime and retain them
// until the renderer establishes its consumer. Discrete user actions retain
// their order. `external-open-enqueued` is only a wake-up for paths already
// retained by main, so one pending wake-up represents all queued paths.
ipcRenderer.on(IPC.ipc.effectIntent, (_event, payload) => {
  if (payload?.type === 'app-quitting') {
    if (appQuittingConsumer === null) appQuittingQueued = true
    else appQuittingConsumer()
    return
  }
  if (effectIntentConsumer === null) {
    if (payload?.type === 'external-open-enqueued') {
      if (externalOpenWakeupQueued) return
      externalOpenWakeupQueued = true
    }
    queuedEffectIntents.push(payload)
    return
  }
  effectIntentConsumer(payload)
})
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
  getAccessTokenProjection: () => safeInvoke(IPC.accessToken.projection),
  rotateAccessToken: () => safeInvoke(IPC.accessToken.rotate),
  onAppQuitting: (cb) => {
    if (appQuittingConsumer !== null) throw new Error('App quitting consumer is already registered')
    appQuittingConsumer = cb
    if (appQuittingQueued) {
      appQuittingQueued = false
      cb()
    }
    return () => {
      if (appQuittingConsumer === cb) appQuittingConsumer = null
    }
  },
  onIntent: (cb) => {
    if (effectIntentConsumer !== null) throw new Error('Client effect intent consumer is already registered')
    while (queuedEffectIntents.length > 0) {
      const intent = queuedEffectIntents[0]
      cb(intent)
      queuedEffectIntents.shift()
      if (intent?.type === 'external-open-enqueued') externalOpenWakeupQueued = false
    }
    effectIntentConsumer = cb
    return () => {
      if (effectIntentConsumer === cb) effectIntentConsumer = null
    }
  },
})

// Readiness is installed only after the lifetime intent listener and complete
// renderer bridge. Main challenges the active document when loading stops.
ipcRenderer.on(IPC.ipc.effectIntentChallenge, (_event, generation) => {
  if (!Number.isSafeInteger(generation) || generation <= 0) return
  ipcRenderer.send(IPC.ipc.effectIntentReady, generation)
})
