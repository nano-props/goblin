import { FolderGit2 } from 'lucide-react'
import { WorkspaceLayoutSidebar } from '#/web/components/workspace-layout/WorkspaceLayoutSidebar.tsx'
import { WorkspaceLayoutShell } from '#/web/components/workspace-layout/WorkspaceLayoutShell.tsx'
import { WorkspaceLayoutPane } from '#/web/components/Layout.tsx'
import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'

interface EmptyWorkspaceViewProps {
  onOpenSettings?: () => void
}

export function EmptyWorkspaceView({ onOpenSettings }: EmptyWorkspaceViewProps) {
  const t = useT()
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const workspacePaneSize = useWorkspacesStore((s) => s.workspacePaneSize)
  const setWorkspacePaneSize = useWorkspacesStore((s) => s.setWorkspacePaneSize)

  return (
    <WorkspaceLayoutShell
      compact={compact}
      zenMode={false}
      workspacePaneActive={false}
      workspacePaneSize={workspacePaneSize}
      onWorkspacePaneSizeChange={setWorkspacePaneSize}
      zenModeToggleEnabled={false}
      sidebarPane={
        <WorkspaceLayoutPane>
          <WorkspaceLayoutSidebar git={null} compact={compact} onOpenSettings={onOpenSettings} />
        </WorkspaceLayoutPane>
      }
      workspacePane={
        <WorkspaceLayoutPane>
          <WorkspaceChrome />
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm text-center">
              <FolderGit2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
              <div className="mb-1 text-sm font-medium text-foreground">{t('empty.title')}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">{t('empty.body')}</div>
            </div>
          </div>
        </WorkspaceLayoutPane>
      }
      singlePaneActivePane="navigator"
    />
  )
}
