import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import {
  EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY,
  WorkspacePaneTabStrip,
} from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarContent,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useT } from '#/web/stores/i18n.ts'

interface WorkspacePaneToolbarProps {
  workspacePaneTabTargetKey: string
  workspacePaneId: string
  items: WorkspacePaneTabItem[]
  activeTabIdentity: string | null
  createAction: WorkspacePaneRuntimeTabCreateAction | null
  trafficLightOffset?: boolean
  onBackToNavigator?: () => void
  trailingActions?: ReactNode
  onSelect: (item: WorkspacePaneTabItem) => void
  onReselect: (item: WorkspacePaneTabItem) => void
  onClose: (item: WorkspacePaneTabItem) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
}

export function WorkspacePaneToolbar({
  workspacePaneTabTargetKey,
  workspacePaneId,
  items,
  activeTabIdentity,
  createAction,
  trafficLightOffset = false,
  onBackToNavigator,
  trailingActions,
  onSelect,
  onReselect,
  onClose,
  onReorder,
}: WorkspacePaneToolbarProps) {
  const t = useT()
  const compact = useIsCompactUi()
  const focusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const backLabel = t('workspace.back-to-branch-navigator')

  return (
    <WorkspaceToolbar draggable={!compact} trafficLightOffset={trafficLightOffset}>
      <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
      <WorkspaceToolbarContent>
        <WorkspaceToolbarPrimary>
          {compact ? (
            <Tip label={backLabel}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onBackToNavigator}
                disabled={!onBackToNavigator}
                aria-label={backLabel}
                title={backLabel}
              >
                <ArrowLeft size={14} />
              </Button>
            </Tip>
          ) : null}
          <WorkspacePaneTabStrip
            workspacePaneTabTargetKey={workspacePaneTabTargetKey}
            items={items}
            workspacePaneId={workspacePaneId}
            activeTabIdentity={activeTabIdentity}
            responsiveCompact={compact}
            panelActive
            focusRegistry={focusRegistry}
            emptyFocusKey={EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY}
            createAction={createAction}
            onSelect={onSelect}
            onReselect={onReselect}
            onClose={onClose}
            onReorder={onReorder}
            activateKeyboardNavigationSelection
          />
        </WorkspaceToolbarPrimary>
        {!compact && trailingActions ? (
          <WorkspaceToolbarActions data-workspace-toolbar-trailing-actions="">
            {trailingActions}
          </WorkspaceToolbarActions>
        ) : null}
      </WorkspaceToolbarContent>
    </WorkspaceToolbar>
  )
}
