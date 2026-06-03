import path from 'node:path'
import { gitResultWithOptions } from '#/system/git/helper.ts'
import type { ExecResult } from '#/shared/git-types.ts'

const CLONE_TIMEOUT_MS = 300_000

export async function cloneRepository(
  parentPath: string,
  directoryName: string,
  url: string,
  signal?: AbortSignal,
): Promise<ExecResult & { path?: string }> {
  const targetPath = path.join(parentPath, directoryName)
  const result = await gitResultWithOptions(
    parentPath,
    { timeoutMs: CLONE_TIMEOUT_MS, signal },
    'clone',
    '--',
    url,
    targetPath,
  )
  return result.ok ? { ...result, path: targetPath } : result
}
