import type { AppOverlayKey } from '#/web/hooks/useAppOverlays.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'
import type { MainWindowRoutePatch } from '#/web/App.tsx'
export interface MainWindowSearch {
  repo?: string
  branch?: string
  overlay?: AppOverlayKey
  detailTab?: DetailTab
}

export function patchMainWindowSearch(current: MainWindowSearch, patch: MainWindowRoutePatch): MainWindowSearch {
  const nextRepo = 'repoId' in patch ? (patch.repoId ?? undefined) : current.repo
  const repoChanged = 'repoId' in patch && nextRepo !== current.repo
  return {
    ...(nextRepo ? { repo: nextRepo } : {}),
    ...('branch' in patch
      ? patch.branch
        ? { branch: patch.branch }
        : {}
      : !repoChanged && current.branch
        ? { branch: current.branch }
        : {}),
    ...('overlay' in patch
      ? patch.overlay
        ? { overlay: patch.overlay }
        : {}
      : current.overlay
        ? { overlay: current.overlay }
        : {}),
    ...('detailTab' in patch
      ? patch.detailTab
        ? { detailTab: patch.detailTab }
        : {}
      : !repoChanged && current.detailTab
        ? { detailTab: current.detailTab }
        : {}),
  }
}
