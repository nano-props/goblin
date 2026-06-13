// Shared helpers for safely invoking processes that take a user-supplied
// SSH alias and remote path as argv. Two concrete consumers today:
//
//   - `system/open-app.ts`     → `openRemoteByAppCli(app, cli, alias, path)`
//     hands the alias + path to a VS Code-family CLI's `--remote` flag.
//   - `system/remote-terminal.ts` → `buildRemoteTerminalInvocation(alias, path)`
//     composes an `ssh -tt -- alias "sh -lc ..."` invocation.
//
// `isSafeRemoteAlias` and `isSafeRemoteAbsolutePath` are the safety gates.
// Both reject any alias / path containing shell metacharacters or control
// bytes, and cap lengths to defend against pathological inputs.

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
