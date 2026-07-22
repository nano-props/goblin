export const HOST_IPC_CALL_CHANNEL = 'goblin:ipc'
export const HOST_IPC_ABORT_CHANNEL = 'goblin:ipc-abort'
export const HOST_IPC_EVENT_CHANNEL = 'goblin:event'
export const CLIENT_EFFECT_INTENT_CHANNEL = 'goblin:client-effect-intent'
export const APP_QUIT_DRAINED_CHANNEL = 'goblin:app-quit-drained'

export const HOST_OPEN_SETTINGS_WINDOW_CHANNEL = 'goblin:host-open-settings-window'
export const HOST_OPEN_EXTERNAL_URL_CHANNEL = 'goblin:host-open-external-url'
export const HOST_OPEN_DIRECTORY_DIALOG_CHANNEL = 'goblin:host-open-directory-dialog'
export const HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL = 'goblin:host-consume-external-open-paths'

export const TERMINAL_NOTIFY_BELL_CHANNEL = 'goblin:terminal-notify-bell'
export const TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL = 'goblin:terminal-send-test-notification'
export const TERMINAL_SET_BADGE_CHANNEL = 'goblin:terminal-set-badge'

// `goblin:rotate-access-token` — main-only. The client calls
// this to invalidate the current token and force a fresh one to be
// generated on the next server start. Main deletes the token file,
// stops the embedded server, and restarts it; the in-memory token
// becomes whatever the freshly-started server read from disk (or
// freshly generated if the file was missing). The response is the
// new access token, which the client surfaces in the Web settings
// page so the user can re-authenticate.
export const ROTATE_ACCESS_TOKEN_CHANNEL = 'goblin:rotate-access-token'
