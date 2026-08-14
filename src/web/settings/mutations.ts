import { useMutation } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { hasErrorCode } from '#/shared/error-code.ts'
import { settingsLog } from '#/web/logger.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

export function useSettingsMutation<TVariables, TResult>(
  label: string,
  task: (variables: TVariables) => Promise<TResult>,
  // Coalesces all concurrent calls for this mutation instance. Use this
  // only for idempotent refresh-style actions where later calls have no
  // distinct payload semantics; do not use it for user-input writes.
  options?: { singleFlight?: boolean },
) {
  const t = useT()
  let inFlight: Promise<TResult> | null = null
  return useMutation({
    mutationFn: async (variables: TVariables) => {
      if (!options?.singleFlight) return await task(variables)
      if (inFlight) return await inFlight
      const promise = task(variables)
      inFlight = promise
      try {
        return await promise
      } finally {
        if (inFlight === promise) inFlight = null
      }
    },
    onError: (error) => {
      settingsLog.warn(`${label} failed`, { err: error })
      if (hasErrorCode(error, 'OUTCOME_UNCERTAIN')) {
        const messageKey = 'error.operation-outcome-uncertain'
        toast.warning(t(messageKey), { id: 'settings-operation-outcome-uncertain' })
        return
      }
      const messageKey = 'error.settings-write-title'
      toast.error(t(messageKey), { id: 'settings-write-failed' })
    },
  })
}
