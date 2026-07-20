// Client-side logger.
//
// Built on `consola` so the [component] prefix pattern already used across
// the codebase (`console.warn('[terminal] ...')`, etc.) becomes a typed,
// level-aware, optionally-silenced logger. The server side keeps `pino` in
// `src/server/logger.ts`; the split is intentional — pino optimizes for
// Node throughput, consola for browser/Electron ergonomics.
//
// Level policy:
//   - Test runs: Silent. Eliminates `console.warn` noise in `bun run test`
//     output without per-test boilerplate. Test code that needs to assert
//     on a log can re-enable a specific tag via `log.level`.
//   - Production: Warn. Only failures and degradations surface in shipped
//     builds; debug noise stays out of the user's DevTools.
//   - Dev: Info. Full visibility while iterating.
//
// Tagged children are pre-bound so call sites stay one symbol:
//   `terminalLog.warn('write failed', { terminalRuntimeSessionId, err })`
//   renders as `[terminal] write failed { terminalRuntimeSessionId: ..., err: ... }`.

import { createConsola, LogLevels, type ConsolaInstance } from 'consola'

const isTest = import.meta.env.MODE === 'test'
const isProd = import.meta.env.PROD === true

export const log: ConsolaInstance = createConsola({
  // `LogLevels` (the numeric record) is the only level export re-shipped by
  // consola's browser entry; the `LogLevel` enum is type-only there.
  level: isTest ? LogLevels.silent : isProd ? LogLevels.warn : LogLevels.info,
})

// Add a new `xxxLog` here as modules are migrated off raw `console.*`.
export const terminalLog = log.withTag('terminal')
export const goblinLog = log.withTag('goblin')
export const settingsLog = log.withTag('settings')
export const externalOpenLog = log.withTag('external-open')
export const bootstrapLog = log.withTag('bootstrap')
export const intentLog = log.withTag('intent')
export const sessionLog = log.withTag('session')
export const workspaceConnectivityLog = log.withTag('workspaceConnectivity')
export const refreshStatusLog = log.withTag('refreshStatus')
export const workspacesLog = log.withTag('workspaces')
export const terminalSessionProviderLog = log.withTag('TerminalSessionProvider')
export const appRuntimeProjectionLog = log.withTag('AppRuntimeProjection')
