import { useMutation } from '@tanstack/react-query'
import { runSettingsAction } from '#/web/settings-actions.ts'

export function useSettingsMutation<TVariables, TResult>(
  label: string,
  task: (variables: TVariables) => Promise<TResult>,
) {
  return useMutation({
    mutationFn: async (variables: TVariables) => await runSettingsAction(label, async () => await task(variables)),
  })
}
