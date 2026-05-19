/** Last segment of a path. Tolerant of either separator so worktree
 *  paths and repo roots render correctly on both POSIX and Windows. */
export function lastPathSegment(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

/** Everything before the last segment, with the trailing separator
 *  stripped. Returns '' for paths with no separator. POSIX/Windows
 *  agnostic for the same reason as `lastPathSegment`. */
export function parentDir(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx > 0 ? trimmed.slice(0, idx) : ''
}

export function tildifyPath(path: string, home: string): string {
  if (!home) return path
  if (path === home) return '~'
  if (path.startsWith(home + '/') || path.startsWith(home + '\\')) return '~' + path.slice(home.length)
  return path
}

export function tildify(path: string): string {
  return tildifyPath(path, window.gbl.homeDir)
}

export function untildifyPath(path: string, home: string): string {
  if (!home) return path
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return home + path.slice(1)
  return path
}

export function untildify(path: string): string {
  return untildifyPath(path, window.gbl.homeDir)
}
