import { unlink } from 'node:fs/promises'
import { app, ipcMain } from 'electron'
import { ROTATE_ACCESS_TOKEN_CHANNEL } from '#/shared/ipc-channels.ts'
import { accessTokenFilePath, readOrCreateAccessToken } from '#/shared/access-token-file.ts'
import { startEmbeddedServer, stopEmbeddedServer, getEmbeddedServerRuntime } from '#/main/server-manager.ts'
import { getMainWindow } from '#/main/window.ts'
import { createClientEntryUrl } from '#/main/window-shell.ts'
import { replantEmbedAuthCookieForRotation } from '#/main/cookie-bootstrap.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { accessTokenNodeLog } from '#/node/logger.ts'

/**
 * Wire the access-token rotation IPC.
 *
 * The client calls `goblin:rotateAccessToken` to invalidate the
 * current token. The flow:
 *
 *  1. Delete the on-disk token file so the next read produces a
 *     fresh value.
 *  2. Stop the embedded server so it drops its in-memory copy of
 *     the old token.
 *  3. Restart the embedded server — it reads (or generates) the
 *     new token, and the embedded main replants the new cookie on
 *     the client's `webContents.session` (see
 *     `#/main/cookie-bootstrap.ts`).
 *
 * Concurrency: a module-level Promise chain serializes concurrent
 * rotation calls. Without this, two rapid clicks (or two clients
 * firing the IPC) race on `unlink` + `stop` + `start` + `read`:
 * the second `unlink` may delete the freshly written token, the
 * second `stop` may issue SIGKILL against the first start's proc,
 * and the second `read` may return a token that no longer matches
 * the server's in-memory state. The mutex is the cheapest way to
 * keep the four steps atomic from the client's perspective.
 *
 * Note: the `get-access-token` and `get-embedded-server-url` IPC
 * channels that used to live here are gone. The client no longer
 * needs the access token in the bootstrap (auth is now via a
 * session cookie planted by `plantEmbedAuthCookie` before
 * `loadURL`), and the server URL is just `window.location.origin`
 * with a Vite proxy in dev. Fewer IPC channels, fewer race
 * surfaces, single auth mechanism.
 */
let rotationPromise: Promise<unknown> = Promise.resolve()

function rotateToken(): Promise<{ accessToken: string }> {
  const next = rotationPromise.then(() => doRotate())
  // Swallow rejections on the chain itself so one failure doesn't
  // poison subsequent rotations; the inner promise's rejection is
  // surfaced to the original caller.
  rotationPromise = next.catch(() => undefined)
  return next
}

async function doRotate(): Promise<{ accessToken: string }> {
  const dataDir = app.getPath('userData')
  const tokenFile = accessTokenFilePath(dataDir)
  try {
    await unlink(tokenFile)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await stopEmbeddedServer()
  await startEmbeddedServer()
  // After the server is back up, read the freshly written file so
  // the value we return is the one the running server is using.
  // (Could be replaced with `runtime.accessToken` once the
  // runtime token and the file token are guaranteed to match —
  // they are today because `startEmbeddedServer` always sets them
  // from the same `readOrCreateAccessToken` call.)
  const accessToken = await readOrCreateAccessToken(dataDir)
  // The embedded client authenticates against the server with an
  // http-only cookie on its `webContents.session`. Without this
  // replant, the cookie still holds the OLD token after the server
  // restart and the next authenticated request fires with a stale
  // credential — the user sees the token gate re-appear even
  // though the rotation IPC returned the new token successfully.
  // Errors are non-fatal: the client's `useAccessTokenStatus`
  // hook falls back to the URL-token path (`?accessToken=…` →
  // POST /api/login → Set-Cookie), so a transient cookie-replant
  // failure (e.g. window destroyed mid-rotation) self-heals on
  // the next page load.
  await tryReplantEmbedAuthCookie(accessToken)
  return { accessToken }
}

/**
 * Replant the auth cookie on the main window's session. Best-effort:
 * a missing runtime, missing window, or cookies.set failure must
 * never propagate up to the rotation IPC handler — the caller (the
 * settings UI) needs the new access token regardless.
 */
async function tryReplantEmbedAuthCookie(accessToken: string): Promise<void> {
  const runtime = getEmbeddedServerRuntime()
  const main = getMainWindow()
  if (!main || runtime?.accessToken !== accessToken) return
  try {
    const { url } = createClientEntryUrl({ routePath: '/' })
    await replantEmbedAuthCookieForRotation({
      accessToken,
      url: url.toString(),
      webContents: main.webContents,
    })
  } catch (err) {
    accessTokenNodeLog.warn({ err }, 'failed to replant embed auth cookie after rotation; client will fall back to URL-token path')
  }
}

export function wireAccessTokenBridgeIpc(): void {
  // Token rotation: deletes the on-disk token, restarts the
  // server, replants the new cookie. The gating matters here
  // because rotation is a destructive operation: a popup could
  // otherwise spin-restart the server, briefly denying the main
  // window service, or race the user into losing their
  // session-resume state.
  //
  // Host info (home dir, platform) used to live here too under
  // `goblin:get-home-dir` / `goblin:get-platform`. They were
  // removed when host info moved to the public `/api/host`
  // endpoint (see `#/server/modules/host-info.ts` and
  // `#/web/stores/host-info.ts`); the embedded client now
  // fetches it the same way the standalone web path does.
  ipcMain.handle(ROTATE_ACCESS_TOKEN_CHANNEL, async (event): Promise<{ accessToken: string }> => {
    if (!isTrustedIpcEvent(event)) {
      throw new Error('Untrusted IPC sender for rotate-access-token')
    }
    return await rotateToken()
  })
}
