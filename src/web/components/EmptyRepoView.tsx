import { FolderGit2 } from 'lucide-react'
import { RepoLayoutSidebar } from '#/web/components/repo-layout/RepoLayoutSidebar.tsx'
import { RepoLayoutWorkspaceShell } from '#/web/components/repo-layout/RepoLayoutWorkspaceShell.tsx'
import { RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

interface EmptyRepoViewProps {
  onOpenSettings?: () => void
}

export function EmptyRepoView({ onOpenSettings }: EmptyRepoViewProps) {
  const t = useT()
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const workspacePaneSize = useReposStore((s) => s.workspacePaneSize)
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)

  return (
    <RepoLayoutWorkspaceShell
      compact={compact}
      zenMode={false}
      repoWorkspaceActive={false}
      workspacePaneSize={workspacePaneSize}
      onWorkspacePaneSizeChange={setWorkspacePaneSize}
      zenModeToggleEnabled={false}
      branchNavigatorPane={
        <RepoWorkspacePane>
          <RepoLayoutSidebar compact={compact} onOpenSettings={onOpenSettings} />
        </RepoWorkspacePane>
      }
      repoWorkspacePane={
        <RepoWorkspacePane>
          <WorkspaceChrome />
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm text-center">
              <FolderGit2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
              <div className="mb-1 text-sm font-medium text-foreground">{t('empty.title')}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">{t('empty.body')}</div>
            </div>
          </div>
        </RepoWorkspacePane>
      }
      singlePaneActivePane="navigator"
      onOpenSettings={onOpenSettings}
    />
  )
}
