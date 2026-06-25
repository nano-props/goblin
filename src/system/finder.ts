import { execa } from 'execa'
import { statSync } from 'node:fs'
import path from 'node:path'
import type { ExecResult } from '#/shared/git-types.ts'

const OPEN_TIMEOUT_MS = 10_000

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Open `dir` in macOS Finder.
 *
 *  The path is passed as argv to Launch Services, so there is no shell
 *  interpolation or escaping surface. This opens the worktree directory
 *  itself rather than revealing it from the parent folder.
 */
export async function openInFinder(p: string): Promise<ExecResult> {
  if (process.platform !== 'darwin') return { ok: false, message: 'error.finder-not-available' }
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }

  try {
    await execa('open', [p], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: p }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
