// Top app bar with embedded repo picker, a per-repo actions group,
// a global settings button, and a large-screen Focus Mode toggle.
//   • repo picker (children) — current repo + open/switch controls.
//   • repo actions (when `repoId` is set) — Refresh, the worktree
//     filter toggle, and the new-worktree action. These used to
//     live in a dedicated RepoToolbar above the branch navigator; they
//     moved up here so the workspace's vertical chrome collapses
//     to the branch navigator and workspace pane.
//   • Focus Mode toggle — sits immediately left of the settings button
//     on large screens, separated from the per-repo actions by a
//     vertical Separator so the layout-mode control reads as its own
//     group; hidden in compact mode.
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
import { Separator } from '#/web/components/ui/separator.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { BranchListPopover } from '#/web/components/branch-navigator/BranchListPopover.tsx'

interface Props {
  onOpenSettings: () => void
  /** Active repo id; the per-repo actions render only when this is
   * set, so the topbar collapses cleanly when no repo is open. */
  repoId: string | null
  children: ReactNode
}

export function Topbar({ onOpenSettings, repoId, children }: Props) {
  const compact = useIsCompactUi()
  const showFocusToggle = !!repoId && !compact
  return (
    <div
      className="topbar relative flex items-center gap-2 border-b border-separator bg-background text-sm"
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      {children}
      {repoId && <RepoToolbarActions repoId={repoId} />}
      {showFocusToggle && (
        <>
          <Separator orientation="vertical" />
          <WorkspaceFocusToggle repoId={repoId!} />
        </>
      )}
      <SettingsButton onClick={onOpenSettings} />
    </div>
  )
}

function WorkspaceFocusToggle({ repoId }: { repoId: string }) {
  const t = useT()
  const workspaceFocused = useReposStore((s) => s.workspaceFocused)
  const toggleWorkspaceFocused = useReposStore((s) => s.toggleWorkspaceFocused)
  const label = t('workspace.focus-toggle-tooltip.enable')
  // In focus mode the branch navigator pane is hidden — surface the
  // same list as a hover card so the user can still browse / switch.
  // Out of focus mode keep the plain text tooltip. In focus mode we
  // intentionally drop the native `title` so the OS tooltip doesn't
  // race the 200ms hover card on touch / OS-default hover delays.
  const button = (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={toggleWorkspaceFocused}
      aria-pressed={workspaceFocused}
      aria-label={t('workspace.focus-toggle-label')}
      title={workspaceFocused ? undefined : label}
    >
      <PanelLeft />
    </Button>
  )
  if (workspaceFocused) {
    return <BranchListPopover repoId={repoId}>{button}</BranchListPopover>
  }
  return <Tip label={label}>{button}</Tip>
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <Tip label={t('topbar.settings-tooltip')}>
      <Button variant="ghost" size="icon-lg" aria-label={t('topbar.settings')} onClick={onClick}>
        <Settings />
      </Button>
    </Tip>
  )
}
