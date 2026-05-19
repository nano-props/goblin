// Preload bridge. Exposes IPC under `window.gbl` to the renderer.
// IMPORTANT: This preload runs with sandbox: true (see window.ts). Only
// the `electron` module is available here — do NOT require Node built-ins
// like `os`, `fs`, or `path`. Anything that needs Node lives
// in the main process and is reached via IPC.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// All `ipcRenderer.invoke` returns a promise that rejects when the main
// handler throws. Renderer code often `void`s these results (openInFinder,
// saveSession), which would otherwise turn
// every transient main-side error into an unhandled rejection. Wrapping
// once at the bridge keeps the renderer's call sites tidy.
function safeInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    console.warn(`[ipc] ${channel} failed`, err)
    throw err
  })
}

// `--gbl-home-dir=...` is injected by main via webPreferences.additionalArguments
// (see window.ts). `process.argv` is one of the few things sandbox-safe
// preloads can still read, which is why we use it here instead of
// `os.homedir()` or a sync IPC.
const HOME_PREFIX = '--gbl-home-dir='
const homeDir = process.argv.find((a) => a.startsWith(HOME_PREFIX))?.slice(HOME_PREFIX.length) ?? ''

contextBridge.exposeInMainWorld('gbl', {
  // ---- Environment -------------------------------------------------------
  homeDir,

  // ---- Repo lifecycle / dialog -------------------------------------------
  openDialog: () => safeInvoke('repo:open-dialog'),
  probe: (cwd) => safeInvoke('repo:probe', cwd),
  pathForFile: (file) => webUtils.getPathForFile(file),

  // ---- Repo data ---------------------------------------------------------
  snapshot: (cwd) => safeInvoke('repo:snapshot', cwd),
  log: (cwd, branch, count) => safeInvoke('repo:log', cwd, branch, count),
  status: (cwd) => safeInvoke('repo:status', cwd),
  patch: (cwd, worktreePath) => safeInvoke('repo:patch', cwd, worktreePath),
  commit: (cwd, hash) => safeInvoke('repo:commit', cwd, hash),

  // ---- Mutating ----------------------------------------------------------
  checkout: (cwd, branch) => safeInvoke('repo:checkout', cwd, branch),
  deleteBranch: (cwd, branch) => safeInvoke('repo:delete-branch', cwd, branch),
  pull: (cwd, branch, worktreePath) => safeInvoke('repo:pull', cwd, branch, worktreePath),
  push: (cwd, branch) => safeInvoke('repo:push', cwd, branch),
  fetch: (cwd) => safeInvoke('repo:fetch', cwd),
  abort: (cwd) => safeInvoke('repo:abort', cwd),
  openGitHub: (cwd, branch) => safeInvoke('repo:open-github', cwd, branch),
  openInFinder: (path) => safeInvoke('repo:open-in-finder', path),
  openInGhostty: (path) => safeInvoke('repo:open-in-ghostty', path),
  ghosttyInstalled: () => safeInvoke('repo:ghostty-installed'),

  // ---- Theme -------------------------------------------------------------
  theme: {
    get: () => safeInvoke('theme:get'),
    setPref: (pref) => safeInvoke('theme:set-pref', pref),
    onChange: (cb) => {
      const listener = (_event, payload) => cb(payload)
      ipcRenderer.on('app:theme-changed', listener)
      return () => ipcRenderer.off('app:theme-changed', listener)
    },
  },

  // ---- Settings ----------------------------------------------------------
  settings: {
    get: () => safeInvoke('settings:get'),
    setFetchInterval: (sec) => safeInvoke('settings:set-fetch-interval', sec),
    onFetchIntervalChange: (cb) => {
      const listener = (_event, sec) => cb(sec)
      ipcRenderer.on('app:fetch-interval-changed', listener)
      return () => ipcRenderer.off('app:fetch-interval-changed', listener)
    },
    saveSession: (session) => safeInvoke('settings:save-session', session),
    onWriteError: (cb) => {
      const listener = (_event, message) => cb(message)
      ipcRenderer.on('app:settings-write-error', listener)
      return () => ipcRenderer.off('app:settings-write-error', listener)
    },
  },

  // ---- Menu push (main → renderer) ---------------------------------------
  onMenuAction: (cb) => {
    const listener = (_event, action) => cb(action)
    ipcRenderer.on('app:menu-invoke', listener)
    return () => ipcRenderer.off('app:menu-invoke', listener)
  },

  // ---- i18n --------------------------------------------------------------
  i18n: {
    /** One-shot pull of { lang, pref, dict } at boot. */
    get: () => safeInvoke('i18n:get'),
    /** Set the user preference: 'auto' | 'en' | 'zh' | 'ko' | 'ja'. */
    setPref: (pref) => safeInvoke('i18n:set-pref', pref),
    /** Subscribe to language changes — receives { lang, pref, dict }. */
    onChange: (cb) => {
      const listener = (_event, payload) => cb(payload)
      ipcRenderer.on('app:i18n-changed', listener)
      return () => ipcRenderer.off('app:i18n-changed', listener)
    },
  },
})
