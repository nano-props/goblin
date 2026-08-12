import { app, ipcMain } from 'electron'
import { GET_ACCESS_TOKEN_PROJECTION_CHANNEL, ROTATE_ACCESS_TOKEN_CHANNEL } from '#/shared/ipc-channels.ts'
import { readOrCreateAccessToken, rotateAccessTokenFile } from '#/shared/access-token-file.ts'
import type { AccessTokenProjection } from '#/shared/access-token.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { getEmbeddedServerRuntime } from '#/main/embedded-server-lifecycle.ts'

/**
 * Wire the access-token rotation IPC.
 *
 * The client calls `goblin:rotateAccessToken` to stage the token for
 * the next server start. The flow:
 *
 *  1. Generate and atomically persist a fresh token.
 *  2. Keep the running server and current cookie unchanged.
 *  3. Activate the persisted token on the next user-initiated restart.
 *
 * Concurrency: a module-level Promise chain serializes concurrent
 * rotation calls. Without this, two rapid clicks (or two clients
 * firing the IPC) could otherwise each return a different value while
 * only the last atomic rename remains on disk. Serialization ensures
 * each rotation is applied at one unambiguous persistence boundary.
 *
 * The read channel exposes the relationship between the running token and
 * the persisted next-start token. It does not participate in authentication;
 * the active client still authenticates with the cookie planted before load.
 */
let tokenFileOperationTail: Promise<unknown> = Promise.resolve()

function serializeTokenFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = tokenFileOperationTail.then(operation)
  // Swallow rejections on the chain itself so one failure doesn't
  // poison subsequent reads or rotations; the inner promise's rejection is
  // surfaced to the original caller.
  tokenFileOperationTail = next.catch(() => undefined)
  return next
}

function accessTokenProjection(accessToken: string): AccessTokenProjection {
  const runtime = getEmbeddedServerRuntime()
  if (!runtime) throw new Error('Embedded server unavailable')
  return {
    accessToken,
    activation: accessToken === runtime.accessToken ? 'current' : 'after-restart',
  }
}

async function readAccessTokenProjection(): Promise<AccessTokenProjection> {
  const dataDir = app.getPath('userData')
  return accessTokenProjection(await readOrCreateAccessToken(dataDir))
}

async function rotateToken(): Promise<AccessTokenProjection> {
  const dataDir = app.getPath('userData')
  const accessToken = await rotateAccessTokenFile(dataDir)
  return { accessToken, activation: 'after-restart' }
}

export function wireAccessTokenIpc(): void {
  // Token rotation atomically stages the next-start token. Trust gating
  // prevents an auxiliary or compromised surface from replacing the
  // credential that will become authoritative after restart.
  //
  // Host info (home dir, platform) used to live here too under
  // `goblin:get-home-dir` / `goblin:get-platform`. They were
  // removed when host info moved to the public `/api/host`
  // endpoint (see `#/server/modules/host-info.ts` and
  // `#/web/stores/host-info.ts`); the embedded client now
  // fetches it the same way the standalone web path does.
  ipcMain.handle(GET_ACCESS_TOKEN_PROJECTION_CHANNEL, async (event): Promise<AccessTokenProjection> => {
    if (!isTrustedIpcEvent(event)) throw new Error('Untrusted IPC sender for get-access-token-projection')
    return await serializeTokenFileOperation(readAccessTokenProjection)
  })
  ipcMain.handle(ROTATE_ACCESS_TOKEN_CHANNEL, async (event): Promise<AccessTokenProjection> => {
    if (!isTrustedIpcEvent(event)) {
      throw new Error('Untrusted IPC sender for rotate-access-token')
    }
    return await serializeTokenFileOperation(rotateToken)
  })
}
