/** Shared names and limits for the access-token authentication boundary. */

/** HTTP cookie name set by `POST /api/login`. */
export const ACCESS_TOKEN_COOKIE = 'goblin_access_token'

/** HTTP header set on every authenticated request from the embedded
 *  client (and from the Electron main's IPC client when calling
 *  the server's HTTP API). */
export const ACCESS_TOKEN_HEADER = 'x-goblin-access-token'

/** WebSocket query parameter accepted alongside the cookie on the
 *  upgrade request. Browsers can't set WS headers, and the
 *  embedded `file://` origin can't carry cross-origin cookies. */
export const ACCESS_TOKEN_QUERY = 't'

/** URL query parameter for QR-code auto-login: a URL of the form
 *  `http://host:port/?accessToken=<token>` is consumed by
 *  `useAccessTokenStatus` on first page load, exchanged for a
 *  cookie via `POST /api/login`, and stripped from the URL. */
export const ACCESS_TOKEN_URL_PARAM = 'accessToken'

/** Server-side cookie lifetime. The cookie is the long-lived auth
 *  artifact; the token stays in the file (and in the server's
 *  in-memory state) for as long as the file is on disk. */
export const ACCESS_TOKEN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/** File name under the server data directory that holds the persistent access token. */
export const ACCESS_TOKEN_FILE_NAME = 'server-token'

export type AccessTokenProjection = {
  accessToken: string
  activation: 'current' | 'after-restart'
}
