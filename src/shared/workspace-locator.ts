declare const workspaceLocatorBrand: unique symbol

export type WorkspaceLocator = string & { readonly [workspaceLocatorBrand]: true }
export type WorkspaceId = WorkspaceLocator

export type WorkspaceLocatorPlatform = 'posix' | 'win32'

export type ParsedWorkspaceLocator =
  | { transport: 'file'; platform: 'posix'; path: string }
  | { transport: 'file'; platform: 'win32'; path: string }
  | { transport: 'ssh'; profile: string; path: string }

const FILE_PREFIX = 'goblin+file://'
const SSH_PREFIX = 'goblin+ssh://'
const SSH_PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const UNRESERVED_RE = /^[A-Za-z0-9._~-]$/
const WINDOWS_PATH_RE = /^[A-Z]:\\(?:[^\\]+(?:\\[^\\]+)*)?$/
const WINDOWS_ROOT_RE = /^[A-Z]:\\$/
const WINDOWS_URI_PATH_RE = /^\/[A-Z]:\/(?:[^/]+(?:\/[^/]+)*)?$/
const POSIX_DRIVE_PATH_RE = /^\/[A-Za-z]:\//
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const UNPAIRED_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/

export function parseWorkspaceLocator(
  input: string,
  platform: WorkspaceLocatorPlatform,
): ParsedWorkspaceLocator | null {
  if (typeof input !== 'string' || CONTROL_RE.test(input)) return null

  const parsed = input.startsWith(FILE_PREFIX)
    ? parseFileLocator(input, platform)
    : input.startsWith(SSH_PREFIX)
      ? parseSshLocator(input)
      : null
  if (!parsed) return null

  return formatWorkspaceLocator(parsed, platform) === input ? parsed : null
}

export function formatWorkspaceLocator(
  locator: ParsedWorkspaceLocator,
  platform: WorkspaceLocatorPlatform,
): WorkspaceLocator | null {
  if (!locator || typeof locator !== 'object') return null
  if (locator.transport === 'ssh') {
    if (
      typeof locator.profile !== 'string' ||
      typeof locator.path !== 'string' ||
      !SSH_PROFILE_RE.test(locator.profile)
    ) {
      return null
    }
    const path = encodePosixPath(locator.path)
    return path ? asWorkspaceLocator(`${SSH_PREFIX}${locator.profile}${path}`) : null
  }

  if (locator.transport !== 'file' || locator.platform !== platform || typeof locator.path !== 'string') return null
  if (locator.platform === 'posix') {
    if (POSIX_DRIVE_PATH_RE.test(locator.path)) return null
    const path = encodePosixPath(locator.path)
    return path ? asWorkspaceLocator(`${FILE_PREFIX}${path}`) : null
  }

  const path = encodeWindowsPath(locator.path)
  return path ? asWorkspaceLocator(`${FILE_PREFIX}${path}`) : null
}

export function isWorkspaceLocator(input: unknown, platform: WorkspaceLocatorPlatform): input is WorkspaceLocator {
  return typeof input === 'string' && parseWorkspaceLocator(input, platform) !== null
}

/** The one accepted grammar for an SSH config profile at every input and execution boundary. */
export function isValidSshProfile(input: unknown): input is string {
  return typeof input === 'string' && SSH_PROFILE_RE.test(input)
}

function parseFileLocator(input: string, platform: WorkspaceLocatorPlatform): ParsedWorkspaceLocator | null {
  const uriPath = input.slice(FILE_PREFIX.length)
  // A file locator begins with the URI path's slash. Anything before that
  // slash would be an authority, which this transport never supports.
  if (!uriPath.startsWith('/')) return null

  if (platform === 'win32') {
    if (!WINDOWS_URI_PATH_RE.test(uriPath)) return null
    const drive = uriPath.slice(1, 3)
    const tail = uriPath.slice(3)
    const segments = decodeUriPathSegments(tail)
    if (!segments) return null
    const path = segments.length === 0 ? `${drive}\\` : `${drive}\\${segments.join('\\')}`
    return { transport: 'file', platform: 'win32', path }
  }

  if (POSIX_DRIVE_PATH_RE.test(uriPath)) return null
  const segments = decodeUriPathSegments(uriPath)
  if (!segments) return null
  return { transport: 'file', platform: 'posix', path: segments.length === 0 ? '/' : `/${segments.join('/')}` }
}

function parseSshLocator(input: string): ParsedWorkspaceLocator | null {
  const rest = input.slice(SSH_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const profile = rest.slice(0, slash)
  if (!SSH_PROFILE_RE.test(profile)) return null
  const segments = decodeUriPathSegments(rest.slice(slash))
  if (!segments) return null
  return { transport: 'ssh', profile, path: segments.length === 0 ? '/' : `/${segments.join('/')}` }
}

function decodeUriPathSegments(uriPath: string): string[] | null {
  if (!uriPath.startsWith('/') || uriPath.includes('\\')) return null
  if (uriPath === '/') return []
  if (uriPath.endsWith('/') || uriPath.includes('//')) return null

  const decoded: string[] = []
  for (const encoded of uriPath.slice(1).split('/')) {
    if (!encoded || !isEncodedSegmentSyntax(encoded)) return null
    let segment: string
    try {
      segment = decodeURIComponent(encoded)
    } catch {
      return null
    }
    if (!isValidDecodedSegment(segment)) return null
    decoded.push(segment)
  }
  return decoded
}

function encodePosixPath(path: string): string | null {
  if (!path.startsWith('/') || CONTROL_RE.test(path) || path.includes('\\')) return null
  if (path === '/') return '/'
  if (path.endsWith('/') || path.includes('//')) return null
  const segments = path.slice(1).split('/')
  if (segments.some((segment) => !isValidDecodedSegment(segment))) return null
  return `/${segments.map(encodeSegment).join('/')}`
}

function encodeWindowsPath(path: string): string | null {
  if (!WINDOWS_PATH_RE.test(path) || CONTROL_RE.test(path)) return null
  const drive = path.slice(0, 2)
  if (WINDOWS_ROOT_RE.test(path)) return `/${drive}/`
  const segments = path.slice(3).split('\\')
  if (segments.some((segment) => !isValidDecodedSegment(segment))) return null
  return `/${drive}/${segments.map(encodeSegment).join('/')}`
}

function isEncodedSegmentSyntax(segment: string): boolean {
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]!
    if (character === '%') {
      if (!/^[0-9A-F]{2}$/.test(segment.slice(index + 1, index + 3))) return false
      index += 2
      continue
    }
    if (!UNRESERVED_RE.test(character)) return false
  }
  return true
}

function isValidDecodedSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.includes('/') &&
    !segment.includes('\\') &&
    !CONTROL_RE.test(segment) &&
    !UNPAIRED_SURROGATE_RE.test(segment)
  )
}

function encodeSegment(segment: string): string {
  let encoded = ''
  for (const character of segment) {
    if (UNRESERVED_RE.test(character)) {
      encoded += character
      continue
    }
    const bytes = new TextEncoder().encode(character)
    for (const byte of bytes) encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return encoded
}

function asWorkspaceLocator(value: string): WorkspaceLocator {
  return value as WorkspaceLocator
}
