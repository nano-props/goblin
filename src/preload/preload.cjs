// Preload bridge. Exposes low-level IPC under `window.goblin` to the renderer.
// IMPORTANT: This preload runs with sandbox: true (see window.ts). Only
// the `electron` module is available here — do NOT require Node built-ins
// like `os`, `fs`, or `path`. Anything that needs Node lives
// in the main process and is reached via IPC.
const { contextBridge, ipcRenderer, webUtils } = require('electron')
const WINDOW_LIFECYCLE_READY_CHANNEL = 'goblin:window-lifecycle-ready'
const WINDOW_LIFECYCLE_FLUSH_DONE_CHANNEL = 'goblin:window-lifecycle-flush-done'

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

function windowPageSetChannel(windowKey) {
  return `goblin:window-page-set:${windowKey}`
}

function windowFlushRequestChannel(windowKey) {
  return `goblin:window-flush-request:${windowKey}`
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

// `--goblin-home-dir=...`, `--goblin-initial-i18n=...` and
// `--goblin-initial-settings=...` are injected by main via
// webPreferences.additionalArguments (see window-shell.ts).
// `process.argv` is one of the few things sandbox-safe preloads can still
// read, which is why we use it here instead of sync IPC.
const HOME_PREFIX = '--goblin-home-dir='
const homeDir = process.argv.find((a) => a.startsWith(HOME_PREFIX))?.slice(HOME_PREFIX.length) ?? ''

const I18N_PREFIX = '--goblin-initial-i18n='
const i18nRaw = process.argv.find((a) => a.startsWith(I18N_PREFIX))?.slice(I18N_PREFIX.length) ?? ''
const initialI18n = i18nRaw
  ? JSON.parse(Buffer.from(i18nRaw, 'base64').toString('utf8'))
  : null

const SETTINGS_PREFIX = '--goblin-initial-settings='
const settingsRaw = process.argv.find((a) => a.startsWith(SETTINGS_PREFIX))?.slice(SETTINGS_PREFIX.length) ?? ''
const initialSettings = settingsRaw
  ? JSON.parse(Buffer.from(settingsRaw, 'base64').toString('utf8'))
  : null
const rpcEventSubscribers = new Set()
let rpcEventListener = null
const windowPageSubscribersByKey = new Map()
const windowPageListenersByKey = new Map()
const windowFlushSubscribersByKey = new Map()
const windowFlushListenersByKey = new Map()

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
  ipcRenderer.on('goblin:event', rpcEventListener)
}

function maybeDisposeRpcEventListener() {
  if (rpcEventSubscribers.size > 0 || !rpcEventListener) return
  ipcRenderer.off('goblin:event', rpcEventListener)
  rpcEventListener = null
}

function ensureWindowPageListener(windowKey) {
  if (windowPageListenersByKey.has(windowKey)) return
  const listener = (_event, page) => {
    const subscribers = windowPageSubscribersByKey.get(windowKey)
    if (!subscribers) return
    for (const cb of subscribers) {
      try {
        cb(page)
      } catch (err) {
        console.warn(`[ipc] ${windowPageSetChannel(windowKey)} subscriber failed`, err)
      }
    }
  }
  windowPageListenersByKey.set(windowKey, listener)
  ipcRenderer.on(windowPageSetChannel(windowKey), listener)
}

function maybeDisposeWindowPageListener(windowKey) {
  const subscribers = windowPageSubscribersByKey.get(windowKey)
  const listener = windowPageListenersByKey.get(windowKey)
  if ((subscribers && subscribers.size > 0) || !listener) return
  ipcRenderer.off(windowPageSetChannel(windowKey), listener)
  windowPageListenersByKey.delete(windowKey)
}

function ensureWindowFlushListener(windowKey) {
  if (windowFlushListenersByKey.has(windowKey)) return
  const listener = (_event, requestId) => {
    const subscribers = windowFlushSubscribersByKey.get(windowKey)
    if (!subscribers || typeof requestId !== 'string' || requestId.length === 0) return
    Promise.allSettled(
      [...subscribers].map(async (cb) => {
        const result = await cb(requestId)
        return isObject(result) && typeof result.ok === 'boolean' && Array.isArray(result.errors)
          ? result
          : { ok: true, errors: [] }
      }),
    ).then((settled) => {
      const errors = []
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          if (!result.value.ok) errors.push(...result.value.errors)
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
      }
      ipcRenderer.send(WINDOW_LIFECYCLE_FLUSH_DONE_CHANNEL, {
        windowKey,
        requestId,
        result: { ok: errors.length === 0, errors },
      })
    })
  }
  windowFlushListenersByKey.set(windowKey, listener)
  ipcRenderer.on(windowFlushRequestChannel(windowKey), listener)
}

function maybeDisposeWindowFlushListener(windowKey) {
  const subscribers = windowFlushSubscribersByKey.get(windowKey)
  const listener = windowFlushListenersByKey.get(windowKey)
  if ((subscribers && subscribers.size > 0) || !listener) return
  ipcRenderer.off(windowFlushRequestChannel(windowKey), listener)
  windowFlushListenersByKey.delete(windowKey)
}

contextBridge.exposeInMainWorld('goblin', {
  homeDir,
  initialI18n,
  initialSettings,
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
    sendTestNotification: () => safeInvoke('goblin:terminal-send-test-notification'),
    setBadge: (count) => { ipcRenderer.send('goblin:terminal-set-badge', count) },
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
    rpcEventSubscribers.add(cb)
    ensureRpcEventListener()
    return () => {
      rpcEventSubscribers.delete(cb)
      maybeDisposeRpcEventListener()
    }
  },
  onWindowPageSet: (windowKey, cb) => {
    if (typeof windowKey !== 'string' || windowKey.length === 0) return () => {}
    let subscribers = windowPageSubscribersByKey.get(windowKey)
    if (!subscribers) {
      subscribers = new Set()
      windowPageSubscribersByKey.set(windowKey, subscribers)
    }
    subscribers.add(cb)
    ensureWindowPageListener(windowKey)
    return () => {
      const nextSubscribers = windowPageSubscribersByKey.get(windowKey)
      if (!nextSubscribers) return
      nextSubscribers.delete(cb)
      if (nextSubscribers.size === 0) windowPageSubscribersByKey.delete(windowKey)
      maybeDisposeWindowPageListener(windowKey)
    }
  },
  notifyWindowReady: (windowKey) => {
    if (typeof windowKey !== 'string' || windowKey.length === 0) return
    ipcRenderer.send(WINDOW_LIFECYCLE_READY_CHANNEL, { windowKey })
  },
  onWindowFlushRequest: (windowKey, cb) => {
    if (typeof windowKey !== 'string' || windowKey.length === 0) return () => {}
    let subscribers = windowFlushSubscribersByKey.get(windowKey)
    if (!subscribers) {
      subscribers = new Set()
      windowFlushSubscribersByKey.set(windowKey, subscribers)
    }
    subscribers.add(cb)
    ensureWindowFlushListener(windowKey)
    return () => {
      const nextSubscribers = windowFlushSubscribersByKey.get(windowKey)
      if (!nextSubscribers) return
      nextSubscribers.delete(cb)
      if (nextSubscribers.size === 0) windowFlushSubscribersByKey.delete(windowKey)
      maybeDisposeWindowFlushListener(windowKey)
    }
  },
})
