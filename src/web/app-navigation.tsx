import { defineComponent, inject, provide, toRef } from 'vue'
import type { InjectionKey, PropType, Ref } from 'vue'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'

const appNavigationKey: InjectionKey<Readonly<Ref<AppNavigationActions>>> = Symbol('app-navigation')

export const AppNavigationProvider = defineComponent<{ value: AppNavigationActions }>({
  name: 'AppNavigationProvider',
  props: {
    value: { type: Object as PropType<AppNavigationActions>, required: true },
  },

  setup(props, { slots }) {
    provide(appNavigationKey, toRef(props, 'value'))
    return () => slots.default?.()
  },
})

export function useAppNavigation(): AppNavigationActions {
  const source = inject(appNavigationKey, null)
  if (!source) throw new Error('useAppNavigation must be used within <AppNavigationProvider>')

  return {
    activateWorkspace: (...args) => source.value.activateWorkspace(...args),
    closeWorkspace: (...args) => source.value.closeWorkspace(...args),
    cycleWorkspace: (...args) => source.value.cycleWorkspace(...args),
    selectRepoBranch: (...args) => source.value.selectRepoBranch(...args),
    selectRepoWorktree: (...args) => source.value.selectRepoWorktree(...args),
    showWorkspaceRootPaneTab: (...args) => source.value.showWorkspaceRootPaneTab(...args),
    commitFilesystemWorkspacePaneRoute: (...args) => source.value.commitFilesystemWorkspacePaneRoute(...args),
    commitWorkspaceRootTerminalSession: (...args) => source.value.commitWorkspaceRootTerminalSession(...args),
    commitWorkspacePaneRoute: (...args) => source.value.commitWorkspacePaneRoute(...args),
    currentWorkspacePaneRoute: (...args) => source.value.currentWorkspacePaneRoute(...args),
    goBack: (...args) => source.value.goBack(...args),
    goForward: (...args) => source.value.goForward(...args),
    openSettings: (...args) => source.value.openSettings(...args),
    openCreateWorktree: (...args) => source.value.openCreateWorktree(...args),
  }
}
