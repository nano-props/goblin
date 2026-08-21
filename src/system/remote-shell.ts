// Safety gates and quoting for process invocations that carry a user-supplied
// SSH alias or remote path. Inputs are length-bounded and reject control bytes;
// shell strings additionally pass through the canonical POSIX quoting helper.

export function isSafeRemoteAlias(alias: string): boolean {
  return alias.length > 0 && alias.length <= 255 && !/[\s\0/?#\\]/.test(alias)
}

export function isSafeRemoteAbsolutePath(remotePath: string): boolean {
  return (
    remotePath.length > 0 &&
    remotePath.length <= 4096 &&
    remotePath.startsWith('/') &&
    !/[\0-\x1f\x7f]/.test(remotePath)
  )
}

/** Single-quote a value for POSIX shell. Doubles as a guard: NUL bytes
 *  are refused outright because no shell can carry them through. */
export function shellQuote(value: string): string {
  if (value.includes('\0')) {
    throw new Error('Refusing to shell-quote a string containing NUL')
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}
