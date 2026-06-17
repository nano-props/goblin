import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { ROTATE_ACCESS_TOKEN_CHANNEL } from '#/shared/ipc-channels.ts'
import { readOrCreateAccessToken, ACCESS_TOKEN_FILE_NAME } from '#/shared/access-token-file.ts'
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
 * The renderer then needs to log in again: any existing cookie
 * references the now-defunct old token. The Web settings page
 * surfaces the new token + a "log in" button so the user can
 * re-authenticate without re-scanning a QR.
 *
 * Failure modes: if the file delete or server stop throws, the
 * error propagates back to the renderer (which surfaces it as
 * an `ipcRequestFailed` toast). The caller is responsible for
 * not leaving the renderer in a half-rotated state; in practice
 * the only side effect is a stale `EmbeddedServerRuntime`
 * reference, which gets replaced as soon as the next
 * `startEmbeddedServer()` call resolves.
 */
export function wireAccessTokenBridgeIpc(): void {
  ipcMain.handle(
    ROTATE_ACCESS_TOKEN_CHANNEL,
    async (event): Promise<{ accessToken: string }> => {
      if (!isTrustedIpcEvent(event)) {
        throw new Error('Untrusted IPC sender for rotate-access-token')
      }
      const tokenFile = path.join(app.getPath('userData'), ACCESS_TOKEN_FILE_NAME)
      try {
        await unlink(tokenFile)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      await stopEmbeddedServer()
      await startEmbeddedServer()
      // After the server is back up, read the freshly written file so
      // the value we return is the one the running server is using.
      const accessToken = await readOrCreateAccessToken(app.getPath('userData'))
      return { accessToken }
    },
  )
}
