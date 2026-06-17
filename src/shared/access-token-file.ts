import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { serverDataDir } from '#/shared/data-dir.ts'
import { ACCESS_TOKEN_FILE_NAME } from '#/shared/access-token.ts'

// 25 base36 chars, exactly 128 bits of entropy (16 random bytes).
// Keep this regex in lockstep with `generateAccessToken` below — it
// catches corruption from a torn write or hand-edited file.
const TOKEN_PATTERN = /^[0-9a-z]{25}$/
const TOKEN_FILE_MODE = 0o600

/** Build the canonical path for the on-disk access token file. */
export function accessTokenFilePath(dataDir: string = serverDataDir()): string {
  return path.join(dataDir, ACCESS_TOKEN_FILE_NAME)
}

/**
 * Generate a 128-bit access token and base36-encode it. The format
 * is 25 chars from `[0-9a-z]`, no padding, no case. Designed to be
 * QR-friendly, paste-friendly, and the smallest printable form
 * that still carries 128 bits of entropy.
 */
export function generateAccessToken(): string {
  // 16 bytes = 128 bits = log_36(2^128) ≈ 24.6 base36 chars. `BigInt(...).toString(36)`
  // strips leading zeros, so without padding a 16-byte random encodes to
  // 1-25 chars depending on the high bits. Roughly 6.6% of random buffers
  // produce a token < 25 chars, which would fail `TOKEN_PATTERN` on
  // subsequent reads and force a re-generation on every server boot.
  // Pad to a fixed width so the on-disk token is always exactly 25 chars.
  const bytes = randomBytes(16)
  return BigInt(`0x${bytes.toString('hex')}`).toString(36).padStart(25, '0')
}

/**
 * Read the access token from `<dataDir>/server-token`, or create
 * it (with `0o600` mode) if missing or corrupt. The token is the
 * single source of truth for both browser (cookie) and embedded
 * renderer (header / `?t=` query) authentication.
 *
 * Atomicity: writes go to `<file>.tmp.<pid>.<rand>` and are
 * `rename()`d onto the final path so a concurrent reader never sees
 * a half-written file. Two processes starting simultaneously can
 * still each generate a different token; whichever renames last
 * wins. The losing process keeps the in-memory token it generated
 * and will 401 against the live file until it restarts. This is
 * acceptable for a single-user desktop app and documented in the
 * plan's "open follow-ups".
 *
 * Pass `dataDir` explicitly when calling from a context that has a
 * different canonical data path (e.g. the Electron main, which
 * owns `app.getPath('userData')`). Omit for the server-internal
 * default (`serverDataDir()`).
 */
export async function readOrCreateAccessToken(dataDir: string = serverDataDir()): Promise<string> {
  const filePath = accessTokenFilePath(dataDir)
  const existing = await readExistingToken(filePath)
  if (existing) return existing
  return await createAccessTokenFile(dataDir, filePath)
}

async function readExistingToken(filePath: string): Promise<string | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const trimmed = raw.trim()
  return TOKEN_PATTERN.test(trimmed) ? trimmed : null
}

async function createAccessTokenFile(dataDir: string, filePath: string): Promise<string> {
  await mkdir(dataDir, { recursive: true })
  const token = generateAccessToken()
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  await writeFile(tmp, `${token}\n`, { mode: TOKEN_FILE_MODE })
  try {
    await rename(tmp, filePath)
  } catch (err) {
    // Best-effort cleanup of the orphan tmp file; the rename error is
    // the one the caller cares about.
    try {
      const { unlink } = await import('node:fs/promises')
      await unlink(tmp)
    } catch {}
    throw err
  }
  // Re-assert mode in case the platform silently ignored the
  // writeFile flag (Windows ignores mode; some FUSE mounts do too).
  try {
    await chmod(filePath, TOKEN_FILE_MODE)
  } catch {}
  return token
}
