import { toast } from 'sonner'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
import { sessionLog } from '#/web/logger.ts'

export function reportOpenRepoPostOpenEffects(
  result: OpenRepoResult,
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
      sessionLog.warn('post-open repo effects failed', { err })
    })
}

function postOpenErrorTitleKey(kind: 'recent-repo'): string {
  switch (kind) {
    case 'recent-repo':
      return 'workspace-picker.recent-save-failed'
  }
}
