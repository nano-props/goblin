export const HOST_IPC_CALL_CHANNEL = 'goblin:ipc'
export const HOST_IPC_ABORT_CHANNEL = 'goblin:ipc-abort'
export const CLIENT_EFFECT_INTENT_CHANNEL = 'goblin:client-effect-intent'
export const CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL = 'goblin:client-effect-intent-challenge'
export const CLIENT_EFFECT_INTENT_READY_CHANNEL = 'goblin:client-effect-intent-ready'
export const APP_QUIT_DRAINED_CHANNEL = 'goblin:app-quit-drained'

export const HOST_OPEN_SETTINGS_WINDOW_CHANNEL = 'goblin:host-open-settings-window'
export const HOST_OPEN_EXTERNAL_URL_CHANNEL = 'goblin:host-open-external-url'
export const HOST_OPEN_DIRECTORY_DIALOG_CHANNEL = 'goblin:host-open-directory-dialog'
export const HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL = 'goblin:host-consume-external-open-paths'

export const TERMINAL_NOTIFY_BELL_CHANNEL = 'goblin:terminal-notify-bell'
export const TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL = 'goblin:terminal-send-test-notification'
export const TERMINAL_SET_BADGE_CHANNEL = 'goblin:terminal-set-badge'

// `goblin:rotate-access-token` — main-only. The client calls
// this to atomically stage a fresh token for the next server start.
// The running server and its authentication cookie stay unchanged;
// the response reports the persisted token and whether it is current for
// the running server or activates after restart.
export const ROTATE_ACCESS_TOKEN_CHANNEL = 'goblin:rotate-access-token'
// Read-only projection of the persisted token relative to the running server.
// Main owns both facts and serializes this read with rotation writes.
export const GET_ACCESS_TOKEN_PROJECTION_CHANNEL = 'goblin:get-access-token-projection'
