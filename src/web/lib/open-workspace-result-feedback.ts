import { toast } from 'sonner'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import { sessionLog } from '#/web/logger.ts'

export function reportOpenWorkspacePostOpenEffects(
  result: OpenWorkspaceResult,
  t: (key: string) => string,
  options: { descriptionPrefix?: string } = {},
): void {
  if (!result.ok || !result.postOpenEffects) return
  void result.postOpenEffects
    .then((errors) => {
      for (const error of errors) {
        const description = options.descriptionPrefix
          ? `${options.descriptionPrefix}\n${t(error.message)}`
          : t(error.message)
        toast.error(t(postOpenErrorTitleKey(error.kind)), { description })
      }
    })
    .catch((err) => {
      sessionLog.warn('post-open workspace effects failed', { err })
    })
}

function postOpenErrorTitleKey(kind: 'recent-workspace'): string {
  switch (kind) {
    case 'recent-workspace':
      return 'workspace-picker.recent-save-failed'
  }
}
