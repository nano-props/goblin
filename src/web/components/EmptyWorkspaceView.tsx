import { defineComponent } from 'vue'
import { FolderGit2 } from '@lucide/vue'
import { WorkspaceLayoutSidebar } from '#/web/components/workspace-layout/WorkspaceLayoutSidebar.tsx'
import { WorkspaceLayoutShell } from '#/web/components/workspace-layout/WorkspaceLayoutShell.tsx'
import { WorkspaceLayoutPane } from '#/web/components/Layout.tsx'
import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

interface EmptyWorkspaceViewProps {
  onOpenSettings?: () => void
}

export const EmptyWorkspaceView = defineComponent<EmptyWorkspaceViewProps>({
  name: 'EmptyWorkspaceView',
  props: ['onOpenSettings'],
  setup(props) {
    const t = useT()
    const uiMode = useResponsiveUiMode()
    const workspacePaneSize = useStoreSelector(workspacesStore, (state) => state.workspacePaneSize)

    return () => {
      const compact = uiMode.value === 'compact'
      return (
        <WorkspaceLayoutShell
          compact={compact}
          zenMode={false}
          workspacePaneActive={false}
          workspacePaneSize={workspacePaneSize.value}
          onWorkspacePaneSizeChange={(size) => workspacesStore.getState().setWorkspacePaneSize(size)}
          zenModeToggleEnabled={false}
          sidebarPane={
            <WorkspaceLayoutPane>
              <WorkspaceLayoutSidebar git={null} compact={compact} onOpenSettings={props.onOpenSettings} />
            </WorkspaceLayoutPane>
          }
          workspacePane={
            <WorkspaceLayoutPane>
              <WorkspaceChrome />
              <div class="flex flex-1 items-center justify-center">
                <div class="max-w-sm text-center">
                  <FolderGit2
                    class="mx-auto mb-3 h-10 w-10 text-muted-foreground/50"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <div class="mb-1 text-sm font-medium text-foreground">{t('empty.title')}</div>
                  <div class="text-xs leading-relaxed text-muted-foreground">{t('empty.body')}</div>
                </div>
              </div>
            </WorkspaceLayoutPane>
          }
          singlePaneActivePane="navigator"
        />
      )
    }
  },
})
