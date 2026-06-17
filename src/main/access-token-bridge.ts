import { unlink } from 'node:fs/promises'
import { app, ipcMain } from 'electron'
import { ROTATE_ACCESS_TOKEN_CHANNEL } from '#/shared/ipc-channels.ts'
import { accessTokenFilePath, readOrCreateAccessToken } from '#/shared/access-token-file.ts'
import { startEmbeddedServer, stopEmbeddedServer } from '#/main/server-manager.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'

/**
 * Wire the access-token rotation IPC.
 *
 * The renderer calls `goblin:rotateAccessToken` to invalidate the
 * current token. The flow:
 *
 *  1. Delete the on-disk token file so the next read produces a
 *     fresh value.
 *  2. Stop the embedded server so it drops its in-memory copy of
 *     the old token.
 *  3. Restart the embedded server — it reads (or generates) the
 *     new token, the IPC client gets the new value as part of
 *     `EmbeddedServerRuntime`, and the renderer shows the new
 *     token in the Web settings page.
 *
 * Concurrency: a module-level Promise chain serializes concurrent
 * rotation calls. Without this, two rapid clicks (or two renderers
 * firing the IPC) race on `unlink` + `stop` + `start` + `read`:
 * the second `unlink` may delete the freshly written token, the
 * second `stop` may issue SIGKILL against the first start's proc,
 * and the second `read` may return a token that no longer matches
 * the server's in-memory state. The mutex is the cheapest way to
 * keep the four steps atomic from the renderer's perspective.
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
  return { accessToken }
}

export function wireAccessTokenBridgeIpc(): void {
  ipcMain.handle(ROTATE_ACCESS_TOKEN_CHANNEL, async (event): Promise<{ accessToken: string }> => {
    if (!isTrustedIpcEvent(event)) {
      throw new Error('Untrusted IPC sender for rotate-access-token')
    }
    return await rotateToken()
  })
}
