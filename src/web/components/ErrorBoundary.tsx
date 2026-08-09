import { AlertTriangle, RefreshCw } from '@lucide/vue'
import { defineComponent, onErrorCaptured, shallowRef, watch } from 'vue'
import type { PropType } from 'vue'
import { Button } from '#/web/components/ui/button.tsx'
import { goblinLog } from '#/web/logger.ts'
import { markRenderErrorLogged } from '#/web/render-error-logging.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

export const ErrorBoundary = defineComponent<{ resetKey?: string }>({
  name: 'ErrorBoundary',
  props: ['resetKey'],
  setup(props, { slots }) {
    const error = shallowRef<unknown | null>(null)

    onErrorCaptured((caught, _instance, info) => {
      // Once this boundary is rendering its own fallback, a descendant error
      // belongs to the next outer boundary (or the application handler).
      if (error.value !== null) return
      if (!markRenderErrorLogged(caught)) goblinLog.error('render crash', { error: caught, componentTrace: info })
      error.value = caught
      return false
    })

    // A new routed surface is an explicit recovery boundary for a prior render failure.
    watch(
      () => props.resetKey,
      () => {
        error.value = null
      },
    )

    return () => {
      if (error.value === null) return slots.default?.()
      return <ErrorFallback error={error.value} onReset={() => (error.value = null)} />
    }
  },
})

const ErrorFallback = defineComponent<{ error: unknown; onReset: () => void }>({
  name: 'ErrorFallback',
  props: {
    error: { type: null, required: true },
    onReset: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()
    return () => {
      const message = props.error instanceof Error ? props.error.message : t('error.render-crash-unknown')
      return (
        <div class="flex flex-1 items-center justify-center p-8">
          <div class="max-w-md space-y-3 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-surface text-danger">
              <AlertTriangle size={22} />
            </div>
            <div class="space-y-1">
              <div class="text-sm font-semibold text-foreground">{t('error.render-crash-title')}</div>
              <div class="text-xs leading-relaxed text-muted-foreground">{message}</div>
            </div>
            <Button type="button" variant="outline" onClick={props.onReset} class="h-8 px-3">
              <RefreshCw class="size-3" />
              {t('error.try-again')}
            </Button>
          </div>
        </div>
      )
    }
  },
})
