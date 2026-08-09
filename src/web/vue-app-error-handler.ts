import type { ComponentPublicInstance } from 'vue'
import { bootstrapLog } from '#/web/logger.ts'
import { markRenderErrorLogged } from '#/web/render-error-logging.ts'

interface VueAppErrorLogger {
  error(message: string, context: unknown): void
}

interface VueAppErrorHandlerInput {
  dev?: boolean
  log?: VueAppErrorLogger
  markErrorLogged?: (error: unknown) => boolean
}

export type VueAppErrorHandler = (error: unknown, instance: ComponentPublicInstance | null, info: string) => void

export function vueAppErrorHandler(input: VueAppErrorHandlerInput = {}): VueAppErrorHandler | undefined {
  const { dev = import.meta.env.DEV, log = bootstrapLog, markErrorLogged = markRenderErrorLogged } = input
  if (dev) return undefined

  return (error, instance, info) => {
    if (markErrorLogged(error)) return
    log.error('uncaught render error', {
      error,
      component: instance?.$options.name,
      info,
    })
  }
}
