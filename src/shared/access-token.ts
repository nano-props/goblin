/** Shared names and limits for the access-token authentication boundary. */

/** HTTP cookie name set by `POST /api/login`. */
export const ACCESS_TOKEN_COOKIE = 'goblin_access_token'

/** HTTP header for authenticated programmatic clients and explicit token handoffs. */
export const ACCESS_TOKEN_HEADER = 'x-goblin-access-token'

/** WebSocket query token for clients with explicit credentials; cookies are also accepted. */
export const ACCESS_TOKEN_QUERY = 't'

/** URL query parameter for QR-code auto-login: a URL of the form
 *  `http://host:port/?accessToken=<token>` is consumed by
 *  `useAccessTokenStatus` on first page load, exchanged for a
 *  cookie via `POST /api/login`, and stripped from the URL. */
export const ACCESS_TOKEN_URL_PARAM = 'accessToken'

/** File name under the server data directory that holds the persistent access token. */
export const ACCESS_TOKEN_FILE_NAME = 'server-token'
