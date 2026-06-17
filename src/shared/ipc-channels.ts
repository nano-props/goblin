export const IPC_CHANNEL = 'goblin:ipc'
export const IPC_ABORT_CHANNEL = 'goblin:ipc-abort'
export const IPC_EVENT_CHANNEL = 'goblin:event'
export const RENDERER_EFFECT_INTENT_CHANNEL = 'goblin:effect-intent'

export const SHELL_OPEN_SETTINGS_WINDOW_CHANNEL = 'goblin:shell-open-settings-window'
export const SHELL_OPEN_EXTERNAL_URL_CHANNEL = 'goblin:shell-open-external-url'
export const SHELL_OPEN_DIRECTORY_DIALOG_CHANNEL = 'goblin:shell-open-directory-dialog'
export const SHELL_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL = 'goblin:shell-consume-external-open-paths'
export const SHELL_OPEN_IN_FINDER_CHANNEL = 'goblin:shell-open-in-finder'

export const TERMINAL_NOTIFY_BELL_CHANNEL = 'goblin:terminal-notify-bell'
export const TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL = 'goblin:terminal-send-test-notification'
export const TERMINAL_SET_BADGE_CHANNEL = 'goblin:terminal-set-badge'

// Renderer bridge exposes `saveClipboardFiles` (single method that takes
// File[]). Channel name mirrors that — no `-binary` suffix, since the
// bridge contract doesn't distinguish binary vs text-clipboard files
// either. (The renderer always passes binary blobs across this channel
// because File -> ArrayBuffer is the wire format; see preload.cjs.)
export const CLIPBOARD_SAVE_FILES_CHANNEL = 'goblin:clipboard-save-files'

// `goblin:rotate-access-token` — main-only. The renderer calls
// this to invalidate the current token and force a fresh one to be
// generated on the next server start. Main deletes the token file,
// stops the embedded server, and restarts it; the in-memory token
// becomes whatever the freshly-started server read from disk (or
// freshly generated if the file was missing). The response is the
// new access token, which the renderer surfaces in the Web settings
// page so the user can re-authenticate.
export const ROTATE_ACCESS_TOKEN_CHANNEL = 'goblin:rotate-access-token'
