// Top app bar with embedded tab strip, a per-repo actions group,
// a workspace layout toggle, and a global settings button.
//   • tab strip (children) — repo tabs + the "open new repo"
//     dropdown + the "more" overflow.
//   • repo actions (when `repoId` is set) — Refresh, the worktree
//     filter toggle, and the new-worktree action. These used to
//     live in a dedicated RepoToolbar above the branch list; they
//     moved up here so the workspace's vertical chrome collapses
//     to just the branch list itself.
//   • workspace layout toggle — flips between `top-bottom` and
//     `left-right`. The icon reflects the *current* layout
//     (PanelTop / PanelLeft) so the user can read the state at
//     a glance, and the tooltip describes the action (the
//     layout that a click will switch to). Hidden in compact
//     mode: the workspace already shows a full-bleed overlay
//     prompting the user to switch to `top-bottom` there, and
//     a topbar toggle would only compete with that CTA. It
//     was dropped from the topbar in commit 4a99c7e when the
//     layout became a single default; this reinstates it as a
//     direct button now that the same default-flip rationale
//     no longer applies.
//   • Settings button (always shown) — navigates to the app
//     settings page.
//
// All five right-side controls (Refresh / Filter / CreateWorktree
// when a repo is open, the workspace layout toggle outside
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
import { Tip } from '#/web/components/Tip.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'

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
      {!compact && <WorkspaceLayoutToggle />}
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

// Single-button workspace layout toggle. The icon shows the
// *current* layout so the state is readable at a glance, and the
// tooltip describes the action (the layout a click will switch
// to) so the affordance is unambiguous. A click flips between
// the two layouts via the repos store action.
function WorkspaceLayoutToggle() {
  const t = useT()
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  const isTopBottom = workspaceLayout === 'top-bottom'
  const Icon: typeof PanelTop = isTopBottom ? PanelTop : PanelLeft
  // Tooltip describes the action, not the current state: when
  // the current layout is left-right, the tooltip says "use
  // top-bottom" (the layout a click will produce).
  const tooltipKey: WorkspaceLayout = isTopBottom ? 'left-right' : 'top-bottom'
  return (
    <Tip label={t(`workspace.layout-tooltip.${tooltipKey}`)}>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={t('workspace.layout-label')}
        aria-pressed={isTopBottom}
        onClick={() => setWorkspaceLayout(isTopBottom ? 'left-right' : 'top-bottom')}
      >
        <Icon />
      </Button>
    </Tip>
  )
}
