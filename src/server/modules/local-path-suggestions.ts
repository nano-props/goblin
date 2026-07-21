import { opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import {
  formatNativeDirectorySuggestion,
  nativeLeafMatches,
  planNativeDirectorySuggestions,
} from '#/server/modules/native-workspace-input.ts'
import type { WorkspaceLocatorPlatform } from '#/shared/workspace-locator.ts'

const MAX_SUGGESTIONS = 20
const MAX_INSPECTED_ENTRIES = 500
const EXPECTED_FILESYSTEM_CODES = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'])

export async function getLocalPathSuggestions(prefix: string, signal?: AbortSignal): Promise<string[]> {
  const platform: WorkspaceLocatorPlatform = process.platform === 'win32' ? 'win32' : 'posix'
  const plan = planNativeDirectorySuggestions(prefix, platform, homedir())
  if (!plan) return []

  let directory
  try {
    directory = await opendir(plan.searchRoot)
  } catch (error) {
    if (isExpectedFilesystemError(error)) return []
    throw error
  }

  const suggestions: string[] = []
  let inspected = 0
  try {
    while (inspected < MAX_INSPECTED_ENTRIES && suggestions.length < MAX_SUGGESTIONS) {
      throwIfAborted(signal)
      const entry = await directory.read()
      if (!entry) break
      inspected += 1
      if (!nativeLeafMatches(entry.name, plan.typedLeaf, plan.platform)) continue
      if (!(await isDirectoryEntry(entry, plan.searchRoot, signal))) continue
      suggestions.push(formatNativeDirectorySuggestion(plan, entry.name))
    }
  } catch (error) {
    if (!isExpectedFilesystemError(error)) throw error
    return []
  } finally {
    await directory.close()
  }
  return suggestions.sort((left, right) => left.localeCompare(right, 'en'))
}

async function isDirectoryEntry(entry: Dirent, searchRoot: string, signal?: AbortSignal): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  throwIfAborted(signal)
  try {
    return (await stat(path.join(searchRoot, entry.name))).isDirectory()
  } catch (error) {
    if (isExpectedFilesystemError(error)) return false
    throw error
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function isExpectedFilesystemError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && EXPECTED_FILESYSTEM_CODES.has(String(error.code))
}
