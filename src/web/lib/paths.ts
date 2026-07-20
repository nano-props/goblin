import { homeDirectory } from '#/web/app-shell-client.ts'
import {
  formatRemoteWorktreeLocator,
  formatWorkspaceDisplayLocation as formatSharedWorkspaceDisplayLocation,
} from '#/shared/workspace-display-location.ts'
import { tildifyPath, untildifyPath } from '#/shared/paths.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
export { tildifyPath, untildifyPath } from '#/shared/paths.ts'

/** Last segment of a path. Tolerant of either separator so worktree
 *  paths and repo roots render correctly on both POSIX and Windows. */
export function lastPathSegment(p: string): string {
  if (/^[A-Za-z]:[/\\]+$/.test(p)) return ''
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

/** Everything before the last segment, with the trailing separator
 *  stripped. Returns '' for paths with no separator. POSIX/Windows
 *  agnostic for the same reason as `lastPathSegment`. */
export function parentDir(p: string): string {
  if (/^[/\\]+$/.test(p)) return p[0] ?? ''
  if (/^[A-Za-z]:[/\\]+$/.test(p)) return `${p.slice(0, 2)}${p[2] === '/' ? '/' : '\\'}`
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx === 2 && /^[A-Za-z]:[/\\]/.test(trimmed)) return trimmed.slice(0, 3)
  if (idx > 0) return trimmed.slice(0, idx)
  if (idx === 0) return trimmed[0] ?? ''
  return ''
}

export function joinPath(parent: string, child: string): string {
  if (!parent) return child
  if (!child) return parent
  if (/[/\\]$/.test(parent)) return parent + child
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\${child}`
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return `${parent}${sep}${child}`
}

export function defaultWorktreePath(workspacePath: string, branch: string): string {
  const slug = branch.trim().replaceAll('/', '-')
  if (!slug) return ''
  const parent = parentDir(workspacePath)
  const name = lastPathSegment(workspacePath) || 'worktree'
  return parent ? joinPath(parent, `${name}-${slug}`) : `${name}-${slug}`
}

export function tildify(path: string): string {
  return tildifyPath(path, homeDirectory())
}

export function untildify(path: string): string {
  return untildifyPath(path, homeDirectory())
}

export function formatWorkspaceDisplayLocation(
  workspaceId: WorkspaceId,
  target?: RemoteWorkspaceTarget | null,
): string {
  return formatSharedWorkspaceDisplayLocation(workspaceId, homeDirectory(), target)
}

export function formatWorktreePath(path: string, target?: RemoteWorkspaceTarget | null): string {
  return target ? formatRemoteWorktreeLocator(target, path) : tildify(path)
}
