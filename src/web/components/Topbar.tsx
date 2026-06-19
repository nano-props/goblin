// Top app bar with embedded tab strip, a per-repo actions group,
// a branch-list visibility toggle, and a global settings button.
//   • tab strip (children) — repo tabs + the "open new repo"
//     dropdown + the "more" overflow.
//   • repo actions (when `repoId` is set) — Refresh, the worktree
//     filter toggle, and the new-worktree action. These used to
//     live in a dedicated RepoToolbar above the branch list; they
//     moved up here so the workspace's vertical chrome collapses
//     to just the branch list itself.
//   • Branch List visibility toggle — enters/exits detail focus,
//     hiding or showing the Branch List View without changing the
//     user's workspace layout. Hidden in compact mode: the
//     workspace already shows a full-bleed overlay prompting the
//     user to switch to `top-bottom` there, and a topbar toggle
//     would only compete with that CTA.
//   • Settings button (always shown) — navigates to the app
//     settings page.
//
// All five right-side controls (Refresh / Filter / CreateWorktree
// when a repo is open, the Branch List visibility toggle outside
// compact mode, and Settings) share `variant="ghost"` +
// `size="icon-lg"` and sit as direct children of the topbar
// (no DropdownMenu wrapper, no inline-flex span), so the
// parent `gap-2` keeps every inter-button gap equal.
//
// The .topbar CSS rule turns the whole bar into the OS drag
// region; child buttons opt out via -webkit-app-region: no-drag
// (set globally on `button` and any element with `data-interactive`).

import type { ReactNode } from 'react'
import { PanelLeft, PanelTop, Settings } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

interface Props {
  onOpenSettings: () => void
  /** Active repo id; the per-repo actions render only when this is
   * set, so the topbar collapses cleanly when no repo is open. */
  repoId: string | null
  children: ReactNode
}

export function Topbar({ onOpenSettings, repoId, children }: Props) {
  // Compact mode (small screen with `left-right` layout) shows a
  // full-bleed overlay prompting the user to switch to
  // `top-bottom` — see `App.tsx` / `compactLeftRight`. The
  // layout toggle is therefore redundant there, and visually
  // competes with the overlay's "switch to top-bottom" CTA.
  const compact = useIsCompactUi()

  return (
    <div
      className="topbar relative flex items-center gap-2 border-b border-separator bg-background text-sm"
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      {children}
      {repoId && <RepoToolbarActions repoId={repoId} />}
      {repoId !== null && !compact && <BranchListVisibilityToggle />}
      <SettingsButton onClick={onOpenSettings} />
    </div>
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

// Single-button Branch List visibility toggle. It reuses the
// workspace's detail focus state: when the Branch List is visible,
// a click enters focus mode and hides it; when hidden, a click exits
// focus mode and restores the current layout.
function BranchListVisibilityToggle() {
  const t = useT()
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const detailFocusMode = useReposStore((s) => s.detailFocusMode)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const setDetailFocusMode = useReposStore((s) => s.setDetailFocusMode)
  const branchListHidden = repoWorkspaceBehavior(workspaceLayout, detailCollapsed, detailFocusMode).mode === 'focus'
  const Icon: typeof PanelTop = workspaceLayout === 'top-bottom' ? PanelTop : PanelLeft
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={t('workspace.branch-list-toggle-label')}
      aria-pressed={branchListHidden}
      onClick={() => setDetailFocusMode(!branchListHidden)}
    >
      <Icon />
    </Button>
  )
}
