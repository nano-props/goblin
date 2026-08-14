import path from 'node:path'
import {
  formatWorkspaceLocator,
  parseWorkspaceLocator,
  type WorkspaceId,
  type WorkspaceLocatorPlatform,
} from '#/shared/workspace-locator.ts'

export interface NativeDirectorySuggestionPlan {
  searchRoot: string
  typedLeaf: string
  displayMode: 'absolute' | 'home-relative'
  platform: WorkspaceLocatorPlatform
  homeDir: string
}

export function workspaceLocatorFromNativeCommandInput(
  rawInput: string,
  platform: WorkspaceLocatorPlatform,
  homeDir: string,
): WorkspaceId | null {
  const input = rawInput
  const parsed = parseWorkspaceLocator(input, platform)
  if (parsed?.transport === 'file') return formatWorkspaceLocator(parsed, platform)
  const expanded = expandNativeHomePath(input, platform, homeDir)
  if (!expanded || !isNativeAbsoluteWorkspacePath(expanded, platform)) return null
  return formatWorkspaceLocator({ transport: 'file', platform, path: expanded }, platform)
}

export function planNativeDirectorySuggestions(
  rawPrefix: string,
  platform: WorkspaceLocatorPlatform,
  homeDir: string,
): NativeDirectorySuggestionPlan | null {
  const prefix = rawPrefix
  if (!prefix.trim() || prefix.startsWith('goblin+file://')) return null
  const expanded = expandNativeHomePath(prefix, platform, homeDir)
  if (!expanded || !isNativeAbsolutePrefix(expanded, platform)) return null

  const implementation = platform === 'win32' ? path.win32 : path.posix
  const separator = platform === 'win32' ? '\\' : '/'
  const endsWithSeparator = prefix === '~' || expanded.endsWith(separator)
  return {
    searchRoot: endsWithSeparator ? expanded : implementation.dirname(expanded),
    typedLeaf: endsWithSeparator ? '' : implementation.basename(expanded),
    displayMode: isHomeRelative(prefix, platform) ? 'home-relative' : 'absolute',
    platform,
    homeDir,
  }
}

export function formatNativeDirectorySuggestion(plan: NativeDirectorySuggestionPlan, name: string): string | null {
  const implementation = plan.platform === 'win32' ? path.win32 : path.posix
  const absolute = implementation.join(plan.searchRoot, name)
  if (!formatWorkspaceLocator({ transport: 'file', platform: plan.platform, path: absolute }, plan.platform))
    return null
  if (plan.displayMode === 'absolute') return absolute
  const relative = implementation.relative(plan.homeDir, absolute)
  const separator = plan.platform === 'win32' ? '\\' : '/'
  return relative ? `~${separator}${relative}` : '~'
}

export function nativeLeafMatches(candidate: string, typedLeaf: string, platform: WorkspaceLocatorPlatform): boolean {
  return platform === 'win32'
    ? candidate.toLocaleLowerCase('en-US').startsWith(typedLeaf.toLocaleLowerCase('en-US'))
    : candidate.startsWith(typedLeaf)
}

function expandNativeHomePath(input: string, platform: WorkspaceLocatorPlatform, homeDir: string): string | null {
  if (!isHomeRelative(input, platform)) return input
  if (!homeDir || !isNativeAbsoluteWorkspacePath(homeDir, platform)) return null
  if (input === '~') return homeDir
  const separator = platform === 'win32' ? '\\' : '/'
  return homeDir.endsWith(separator) ? `${homeDir}${input.slice(2)}` : `${homeDir}${input.slice(1)}`
}

function isHomeRelative(input: string, platform: WorkspaceLocatorPlatform): boolean {
  return input === '~' || input.startsWith(platform === 'win32' ? '~\\' : '~/')
}

function isNativeAbsoluteWorkspacePath(input: string, platform: WorkspaceLocatorPlatform): boolean {
  if (/[\u0000-\u001f\u007f]/u.test(input)) return false
  return platform === 'win32' ? /^[A-Z]:\\/.test(input) : input.startsWith('/') && !input.includes('\\')
}

function isNativeAbsolutePrefix(input: string, platform: WorkspaceLocatorPlatform): boolean {
  if (!isNativeAbsoluteWorkspacePath(input, platform)) return false
  if (platform === 'win32' && input.startsWith('\\\\')) return false
  const separator = platform === 'win32' ? '\\' : '/'
  const rootLength = platform === 'win32' ? 3 : 1
  const remainder = input.slice(rootLength)
  const pathBody = remainder.endsWith(separator) ? remainder.slice(0, -1) : remainder
  if (!pathBody) return true
  return !pathBody.split(separator).some((segment) => segment === '.' || segment === '..' || segment === '')
}
