// Preload bridge. Exposes low-level IPC under `window.goblinNative` to the
// renderer. The renderer no longer needs a bootstrap roundtrip here — the
// server renders the full bootstrap JSON into the HTML response
// (`<script id="goblin-bootstrap">`), which is read by `web/bootstrap.ts`
// after page load. The preload is now strictly an IPC bridge: every
// function it exposes corresponds to a capability that the renderer
// could not get from the server (open settings window, send IPC
// requests to main, etc.).
//
// IMPORTANT: This preload runs with sandbox: true (see window.ts). Only
// the `electron` module is available here — do NOT require Node built-ins
// like `os`, `fs`, or `path`, and do NOT require `pino` / `consola`.
// The `console.warn` calls below are intentionally raw: in sandboxed
// preload we have no structured logger available, and these errors are
// only visible in DevTools where the renderer-side `web/logger.ts` will
// already be emitting its own (more detailed) records.
const { contextBridge, ipcRenderer, webUtils } = require('electron')
// Mirrors `src/shared/clipboard-paste.ts:CLIPBOARD_FALLBACK_FILE_NAME`.
// CommonJS preloads can't import from the Vite-resolved `src/` tree at
// runtime, so we duplicate the literal here. If the constant ever
// changes, update both copies (a unit test in
// `src/shared/clipboard-paste.test.ts` could lock this if it became
// worth the friction).
const CLIPBOARD_FALLBACK_FILE_NAME = 'clipboard.bin'
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
  clipboard: {
    saveFiles: 'goblin:clipboard-save-files',
  },
  accessToken: {
    rotate: 'goblin:rotate-access-token',
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
  invokeIpc: ({ path, input, requestId }) => ipcCall({ path, input, requestId }),
  abortIpc: (requestId) => safeInvoke(IPC.ipc.abort, { requestId }),
  pathForFile: (file) => {
    // `webUtils` itself is destructured at the top of this file, so
    // a missing symbol there would already have crashed the preload
    // load — by the time we get here it's the call that can throw.
    // That happens when a non-`File` object reaches us (synthetic
    // `File` from older test mocks, IPC proxies that lost the
    // prototype, etc.) or when an internal Electron check fails.
    // Returning `''` matches the renderer's contract: an empty
    // path-attempt result falls through to the blob-save tier, and
    // a `paste-file-failed` toast surfaces the loss to the user.
    try {
      return webUtils.getPathForFile(file)
    } catch (err) {
      console.warn('[preload] pathForFile failed', err)
      return ''
    }
  },
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
  // Clipboard paste / drop blob backstop. `File` is not structured-clonable
  // across the contextBridge, so we materialise each blob to a plain
  // `{name, bytes: ArrayBuffer}` here in the preload before invoking IPC.
  // (Electron's IPC has no `transfer` list — `ArrayBuffer` and
  // `Uint8Array` both copy — so the choice is a typing/contract one.)
  // Errors are swallowed to `[]` because the renderer-side resolver
  // treats `[]` as "blob save failed for everything" and surfaces a
  // single `paste-file-failed` toast.
  saveClipboardFiles: async (files) => {
    if (!Array.isArray(files) || files.length === 0) return []
    try {
      const payload = await Promise.all(
        files.map(async (file) => ({
          // Mirrors the web HTTP backend: the empty-name fallback
          // (CLIPBOARD_FALLBACK_FILE_NAME) is the literal duplicated
          // there as well, and the server-side `sanitizeBaseName`
          // preserves it. Keeping the names identical across runtimes
          // avoids a class of debugging where Electron and web leave
          // different temp filenames for the same paste payload.
          name:
            typeof file?.name === 'string' && file.name.length > 0
              ? file.name
              : CLIPBOARD_FALLBACK_FILE_NAME,
          bytes: await file.arrayBuffer(),
        })),
      )
      const result = await safeInvoke(IPC.clipboard.saveFiles, payload)
      return Array.isArray(result) ? result.filter((p) => typeof p === 'string') : []
    } catch (err) {
      console.warn('[preload] saveClipboardFiles failed', err)
      return []
    }
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

// Auth model: the renderer is identical in every runtime. The
// embedded Electron main plants the auth cookie on the renderer's
// `webContents.session` BEFORE the URL loads, so the renderer's
// first request (the `useAccessTokenStatus` whoami probe) already
// carries the cookie and clears the gate without user input. The
// web path skips the gate entirely — the user pastes the token
// once and `useAccessTokenStatus` exchanges it for the same
// cookie. After that, both paths look identical: the renderer
// calls `fetchServerJson('/api/whoami')`, the browser attaches
// the cookie, the server returns 200.
//
// The preload does NOT seed `window.__GOBLIN_BOOTSTRAP__` with
// anything — the bootstrap is empty on first paint in every
// runtime, and the renderer fetches i18n before mounting the normal
// app tree, then fetches host info and settings from the dedicated
// `/api/*` endpoints during the app bootstrap hooks. The embedded
// path used to also seed
// homeDir + platform via `goblin:get-home-dir` /
// `goblin:get-platform` IPC; those channels were removed when
// host info moved to the public `/api/host` endpoint, so the
// preload is now strictly an IPC bridge for browser-missing
// capabilities (open settings window, send IPC requests, etc.).
