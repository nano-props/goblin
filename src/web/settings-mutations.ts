import { useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { runSettingsAction } from '#/web/settings-actions.ts'

export function useSettingsMutation<TVariables, TResult>(
  label: string,
  task: (variables: TVariables) => Promise<TResult>,
  // Coalesces all concurrent calls for this mutation instance. Use this
  // only for idempotent refresh-style actions where later calls have no
  // distinct payload semantics; do not use it for user-input writes.
  options?: { singleFlight?: boolean },
) {
  const inFlightRef = useRef<Promise<TResult | null> | null>(null)
  return useMutation({
    mutationFn: async (variables: TVariables) => {
      if (!options?.singleFlight) return await runSettingsAction(label, async () => await task(variables))
      if (inFlightRef.current) return await inFlightRef.current
      const promise = runSettingsAction(label, async () => await task(variables))
      inFlightRef.current = promise
      try {
        return await promise
      } finally {
        if (inFlightRef.current === promise) inFlightRef.current = null
      }
    },
  })
}
