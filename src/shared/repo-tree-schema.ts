// Path schemas for the worktree-scoped file tree (docs/filetree.md).
//
// `prefix` is a relative POSIX path inside the worktree root. We
// reject:
//   - empty strings (callers should omit the field instead);
//   - paths that escape the worktree root (`..` segments, mid-path
//     `..`, leading `/`, absolute paths);
//   - control characters (NUL bytes especially; embedded newlines,
//     tabs and CR could confuse downstream glob/stream parsing).
//   - backslashes -- the schema is POSIX-only, and the rest of the
//     source layer assumes forward slashes.
//
// We do NOT impose case sensitivity here -- the local walker
// already deals with case sensitivity at the OS level, and a case
// mismatch on a real platform is the walker's problem, not the
// schema's.

import * as v from 'valibot'

const CONTROL_CHARS = /[\x00-\x1F\x7F]/u

/** Strictly relative POSIX path inside a worktree. The worktree
 *  root itself is represented by omitting the field, NOT by the
 *  literal `.`. */
export const RepoTreePrefixSchema = v.pipe(
  v.string(),
  v.minLength(1, 'prefix cannot be empty'),
  v.maxLength(4096, 'prefix too long'),
  v.check((value: string) => {
    if (CONTROL_CHARS.test(value)) return false
    if (value.includes('\\')) return false
    if (value.startsWith('/')) return false
    for (const segment of value.split('/')) {
      if (segment === '' || segment === '.' || segment === '..') return false
    }
    return true
  }, 'prefix must be a relative POSIX path inside the worktree'),
)
