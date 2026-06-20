// Top app bar with embedded tab strip, a per-repo actions group,
// a large-screen Branch View toggle, and a global settings button.
//   • tab strip (children) — repo tabs + the "open new repo"
//     dropdown + the "more" overflow.
//   • repo actions (when `repoId` is set) — Refresh, the worktree
//     filter toggle, and the new-worktree action. These used to
//     live in a dedicated RepoToolbar above the branch list; they
//     moved up here so the workspace's vertical chrome collapses
//     to the branch list and workspace pane.
//   • Branch View toggle — hidden in compact mode, because compact
//     navigation switches between Branch View and Workspace View
//     inside the workspace itself.
//   • Settings button (always shown) — navigates to the app
//     settings page.
//
// The right-side controls share `variant="ghost"` + `size="icon-lg"`
// and sit as direct children of the topbar (no DropdownMenu wrapper,
// no inline-flex span), so the parent `gap-2` keeps every inter-button
// gap equal.
//
// The .topbar CSS rule turns the whole bar into the OS drag
// region; child buttons opt out via -webkit-app-region: no-drag
// (set globally on `button` and any element with `data-interactive`).

import type { ReactNode } from 'react'
import { PanelLeft, Settings } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'

interface Props {
  onOpenSettings: () => void
  /** Active repo id; the per-repo actions render only when this is
   * set, so the topbar collapses cleanly when no repo is open. */
  repoId: string | null
  children: ReactNode
}

export function Topbar({ onOpenSettings, repoId, children }: Props) {
  const compact = useIsCompactUi()
  return (
    <div
      className="topbar relative flex items-center gap-2 border-b border-separator bg-background text-sm"
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      {children}
      {repoId && <RepoToolbarActions repoId={repoId} />}
      {repoId && !compact && <BranchListVisibilityToggle />}
      <SettingsButton onClick={onOpenSettings} />
    </div>
  )
}

function BranchListVisibilityToggle() {
  const t = useT()
  const branchListPaneVisible = useReposStore((s) => s.branchListPaneVisible)
  const toggleBranchListPaneVisible = useReposStore((s) => s.toggleBranchListPaneVisible)
  const label = t(
    branchListPaneVisible
      ? 'workspace.branch-list-toggle-tooltip.hide'
      : 'workspace.branch-list-toggle-tooltip.show',
  )
  return (
    <Tip label={label}>
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={toggleBranchListPaneVisible}
        aria-pressed={!branchListPaneVisible}
        aria-label={t('workspace.branch-list-toggle-label')}
        title={label}
        className={cn(
          !branchListPaneVisible &&
            'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <PanelLeft />
      </Button>
    </Tip>
  )
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <Button variant="ghost" size="icon-lg" aria-label={t('topbar.settings')} onClick={onClick}>
      <Settings />
    </Button>
  )
}
