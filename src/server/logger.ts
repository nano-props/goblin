import pino from 'pino'

function resolveServerLogLevel(): pino.LevelWithSilent {
  const envLevel = process.env.GOBLIN_SERVER_LOG_LEVEL?.trim()
  if (
    envLevel === 'fatal' ||
    envLevel === 'error' ||
    envLevel === 'warn' ||
    envLevel === 'info' ||
    envLevel === 'debug' ||
    envLevel === 'trace' ||
    envLevel === 'silent'
  ) {
    return envLevel
  }
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info'
}

export const serverLogger = pino({
  name: 'goblin-server',
  level: resolveServerLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
})
