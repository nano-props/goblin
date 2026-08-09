import { useMutation } from '@tanstack/vue-query'
import { runSettingsAction } from '#/web/settings-actions.ts'

export function useSettingsMutation<TVariables, TResult>(
  label: string,
  task: (variables: TVariables) => Promise<TResult>,
  // Coalesces all concurrent calls for this mutation instance. Use this
  // only for idempotent refresh-style actions where later calls have no
  // distinct payload semantics; do not use it for user-input writes.
  options?: { singleFlight?: boolean },
) {
  let inFlight: Promise<TResult | null> | null = null
  return useMutation({
    mutationFn: async (variables: TVariables) => {
      if (!options?.singleFlight) return await runSettingsAction(label, async () => await task(variables))
      if (inFlight) return await inFlight
      const promise = runSettingsAction(label, async () => await task(variables))
      inFlight = promise
      try {
        return await promise
      } finally {
        if (inFlight === promise) inFlight = null
      }
    },
  })
}
