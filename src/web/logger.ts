// Browser logging is silent in tests, warning-only in production, and informational in development.

import { createConsola, LogLevels, type ConsolaInstance } from 'consola'

const isTest = import.meta.env.MODE === 'test'
const isProd = import.meta.env.PROD === true

export const log: ConsolaInstance = createConsola({
  level: isTest ? LogLevels.silent : isProd ? LogLevels.warn : LogLevels.info,
})

// Keep subsystem names centralized and stable for diagnostics.
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
export const navigationLog = log.withTag('navigation')
