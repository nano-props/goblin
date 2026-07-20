import { stat } from 'node:fs/promises'

export async function worktreePathIsMissing(worktreePath: string): Promise<boolean> {
  try {
    await stat(worktreePath)
    return false
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
}
