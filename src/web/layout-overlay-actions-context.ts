import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

export interface LayoutOverlayActions {
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  openCreateWorktree: () => void
}

const layoutOverlayActionsKey: InjectionKey<LayoutOverlayActions> = Symbol('layout-overlay-actions')

export function provideLayoutOverlayActions(actions: LayoutOverlayActions): void {
  provide(layoutOverlayActionsKey, actions)
}

export function useLayoutOverlayActions(): LayoutOverlayActions | null {
  return inject(layoutOverlayActionsKey, null)
}
