import { toast } from 'vue-sonner'
import type {
  CloseWorkspaceResult,
  OpenWorkspacePostOpenError,
  OpenWorkspaceResult,
} from '#/web/stores/workspaces/types.ts'
import { sessionLog } from '#/web/logger.ts'

export function reportOpenWorkspacePostOpenEffects(
  result: OpenWorkspaceResult,
  t: (key: string) => string,
  options: { descriptionPrefix?: string } = {},
): void {
  if (!result.ok || !result.postOpenEffects) return
  void result.postOpenEffects
    .then((errors) => {
      for (const error of errors) reportOpenWorkspacePostOpenError(error, t, options)
    })
    .catch((err) => {
      sessionLog.warn('post-open workspace effects failed', { err })
    })
}

export function reportOpenWorkspaceUncertainty(
  result: OpenWorkspaceResult,
  t: (key: string) => string,
  options: { descriptionPrefix?: string } = {},
): boolean {
  if (result.ok || result.kind !== 'uncertain') return false
  const description = options.descriptionPrefix
    ? `${options.descriptionPrefix}\n${t(result.message)}`
    : t(result.message)
  toast.warning(description, { id: 'workspace-open-outcome-uncertain' })
  return true
}

export function reportCloseWorkspaceFailure(
  result: CloseWorkspaceResult,
  t: (key: string) => string,
): boolean {
  if (result.ok) return false
  if (result.kind === 'uncertain') toast.warning(t(result.message))
  else toast.error(t(result.message))
  return true
}

export function reportOpenWorkspacePostOpenError(
  error: OpenWorkspacePostOpenError,
  t: (key: string) => string,
  options: { descriptionPrefix?: string } = {},
): void {
  if (error.kind === 'operation-outcome-uncertain') {
    toast.warning(t(error.message), { id: 'workspace-open-outcome-uncertain' })
    return
  }
  const description = options.descriptionPrefix ? `${options.descriptionPrefix}\n${t(error.message)}` : t(error.message)
  toast.error(t(postOpenErrorTitleKey(error.kind)), { description })
}

function postOpenErrorTitleKey(kind: 'recent-workspace'): string {
  switch (kind) {
    case 'recent-workspace':
      return 'workspace-picker.recent-save-failed'
  }
}
