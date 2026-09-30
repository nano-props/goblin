import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import path from 'node:path'

/** Best-effort foreground label; process and PTY lifecycle never depend on it. */
export function readTerminalProcessName(pid: number, fallback: string): string {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      // comm is parenthesized and may itself contain spaces or parentheses.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const foregroundPid = Number(fields[5]) // tpgid (field 8)
      if (!Number.isSafeInteger(foregroundPid) || foregroundPid <= 0) return fallback
      return readFileSync(`/proc/${foregroundPid}/comm`, 'utf8').trim() || fallback
    }
    if (process.platform === 'darwin') {
      const options: ExecFileSyncOptionsWithStringEncoding = {
        encoding: 'utf8',
        timeout: 200,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
      const foregroundPid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'tpgid='], options).trim())
      if (!Number.isSafeInteger(foregroundPid) || foregroundPid <= 0) return fallback
      const command = execFileSync('/bin/ps', ['-p', String(foregroundPid), '-o', 'comm='], options).trim()
      return path.basename(command) || fallback
    }
  } catch {
    // Processes can exit between the two reads; retain the launch label.
  }
  return fallback
}
