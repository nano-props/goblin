import { opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import {
  formatNativeDirectorySuggestion,
  nativeLeafMatches,
  planNativeDirectorySuggestions,
  type NativeDirectorySuggestionPlan,
} from '#/server/modules/native-workspace-input.ts'
import type { WorkspaceLocatorPlatform } from '#/shared/workspace-locator.ts'

const MAX_SUGGESTIONS = 20
const MAX_INSPECTED_ENTRIES = 500
const EXPECTED_FILESYSTEM_CODES = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG'])

export async function getLocalPathSuggestions(prefix: string, signal?: AbortSignal): Promise<string[]> {
  const platform: WorkspaceLocatorPlatform = process.platform === 'win32' ? 'win32' : 'posix'
  return await getLocalPathSuggestionsForHost({ prefix, platform, homeDir: homedir(), signal })
}

export async function getLocalPathSuggestionsForHost(input: {
  prefix: string
  platform: WorkspaceLocatorPlatform
  homeDir: string
  signal?: AbortSignal
}): Promise<string[]> {
  const plan = planNativeDirectorySuggestions(input.prefix, input.platform, input.homeDir)
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
      throwIfAborted(input.signal)
      const entry = await directory.read()
      if (!entry) break
      inspected += 1
      if (!nativeLeafMatches(entry.name, plan.typedLeaf, plan.platform)) continue
      if (!(await isDirectoryEntry(entry, plan, input.signal))) continue
      const suggestion = formatNativeDirectorySuggestion(plan, entry.name)
      if (suggestion) suggestions.push(suggestion)
    }
  } catch (error) {
    if (!isExpectedFilesystemError(error)) throw error
    return []
  } finally {
    await directory.close()
  }
  return suggestions.sort((left, right) => left.localeCompare(right, 'en'))
}

async function isDirectoryEntry(
  entry: Dirent,
  plan: NativeDirectorySuggestionPlan,
  signal?: AbortSignal,
): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  throwIfAborted(signal)
  try {
    const implementation = plan.platform === 'win32' ? path.win32 : path.posix
    return (await stat(implementation.join(plan.searchRoot, entry.name))).isDirectory()
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
