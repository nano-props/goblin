import type { RefObject } from 'react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import type { WorkspacePaneTabDnd } from '#/web/components/workspace-pane/workspace-pane-tab-dnd.ts'
import { isSortableWorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-dnd.ts'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import {
  SortableWorkspacePaneTab,
  WorkspacePaneNewButton,
  WorkspacePaneTab,
  WorkspacePaneTabSwitcherPopover,
  WorkspacePaneTabTooltipLayer,
  type WorkspacePaneT,
  type WorkspacePaneTabCreateAction,
} from '#/web/components/workspace-pane/WorkspacePaneTabPresentation.tsx'
import { workspacePaneRuntimeTabProvider } from '#/web/workspace-pane/tab-providers.ts'

// Virtual right-edge for the compact tab's separator computation. The popover
// trigger that follows the tab is the only real DOM node on that side, but it
// doesn't report hover state, so we use this sentinel identity instead.
const WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID = '__workspace-pane-compact-trailing-action__'
const WORKSPACE_PANE_NEW_ACTION_ID = '__workspace-pane-new-action__'

export interface WorkspacePaneTabBodyContext {
  activeTabIdentity: string | null
  panelActive?: boolean
  focusableTabIdentity: string | null
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  hoveredTabIdentity: string | null
  tabIdForItem: (item: WorkspacePaneTabItem) => string
  onHoverChange: (identity: string | null) => void
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, identity: string) => void
  t: WorkspacePaneT
  tabInteractionBlocked: boolean
}

interface WorkspacePaneTabBodyCommonProps {
  items: WorkspacePaneTabItem[]
  context: WorkspacePaneTabBodyContext
}

interface WorkspacePaneCompactTabsBodyProps extends WorkspacePaneTabBodyCommonProps {
  compactItem: WorkspacePaneTabItem | null
  workspacePaneId: string
  createAction: WorkspacePaneTabCreateAction | null
}

export function WorkspacePaneCompactTabsBody({
  items,
  compactItem,
  workspacePaneId,
  context,
  createAction,
}: WorkspacePaneCompactTabsBodyProps) {
  const {
    activeTabIdentity,
    panelActive,
    focusableTabIdentity,
    focusRegistry,
    hoveredTabIdentity,
    tabIdForItem,
    onHoverChange,
    onSelect,
    onClose,
    onKeyDown,
    t,
    tabInteractionBlocked,
  } = context
  // Compact tabs intentionally use muted chrome even when selected, so
  // selection should not suppress separators; hover still does.
  const compactActiveVisualIdentity = null

  return (
    <ToolbarTabStripBody className="flex-1">
      <WorkspacePaneTabTooltipLayer
        items={items}
        role="tablist"
        aria-label={t('workspace-pane-tabs.tabs')}
        className="flex-1"
      >
        {compactItem ? (
          <WorkspacePaneTab
            item={compactItem}
            isActive={!!panelActive && compactItem.identity === activeTabIdentity}
            isSelected={compactItem.identity === activeTabIdentity}
            isFocusable={compactItem.identity === focusableTabIdentity}
            tabId={
              compactItem.kind === 'runtime'
                ? workspacePaneRuntimeTabProvider(compactItem.runtimeType).buttonId(workspacePaneId, 0)
                : tabIdForItem(compactItem)
            }
            focusRegistry={focusRegistry}
            onSelect={onSelect}
            onClose={onClose}
            onKeyDown={onKeyDown}
            t={t}
            interactionDisabled={tabInteractionBlocked}
            compact
            showSeparator={shouldShowWorkspacePaneTabSeparator({
              leftId: compactItem.identity,
              rightId: WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID,
              activeId: compactActiveVisualIdentity,
              hoveredId: hoveredTabIdentity,
            })}
            onHoverChange={onHoverChange}
          />
        ) : null}
      </WorkspacePaneTabTooltipLayer>
      <WorkspacePaneTabSwitcherPopover
        items={items}
        activeTabIdentity={activeTabIdentity}
        label={t('workspace-pane-tabs.tabs')}
        createAction={createAction}
        tabInteractionBlocked={tabInteractionBlocked}
        onSelect={onSelect}
        onClose={onClose}
        t={t}
      />
    </ToolbarTabStripBody>
  )
}

interface WorkspacePaneScrollableTabsBodyProps extends WorkspacePaneTabBodyCommonProps {
  createAction: WorkspacePaneTabCreateAction | null
  newButtonRef: RefObject<HTMLButtonElement | null>
  workspacePaneId: string
  dnd: WorkspacePaneTabDnd
}

export function WorkspacePaneScrollableTabsBody({
  items,
  context,
  createAction,
  newButtonRef,
  workspacePaneId,
  dnd,
}: WorkspacePaneScrollableTabsBodyProps) {
  const {
    activeTabIdentity,
    panelActive,
    focusableTabIdentity,
    focusRegistry,
    hoveredTabIdentity,
    tabIdForItem,
    onHoverChange,
    onSelect,
    onClose,
    onKeyDown,
    t,
    tabInteractionBlocked,
  } = context
  const { sensors, restrictToVisibleTabStrip, sortableIds, handleDragEnd } = dnd
  const activeVisualIdentity = panelActive ? activeTabIdentity : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVisibleTabStrip]}
      onDragEnd={handleDragEnd}
    >
      <ToolbarTabStripBody scroll>
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          <WorkspacePaneTabTooltipLayer items={items} role="tablist" aria-label={t('workspace-pane-tabs.tabs')}>
            {items.map((item, index) => {
              const nextItem = items[index + 1]
              const rightId = nextItem ? nextItem.identity : WORKSPACE_PANE_NEW_ACTION_ID
              const commonProps = {
                item,
                isActive: !!panelActive && item.identity === activeTabIdentity,
                isSelected: item.identity === activeTabIdentity,
                isFocusable: item.identity === focusableTabIdentity,
                index,
                total: items.length,
                tabId: tabIdForItem(item),
                focusRegistry,
                showSeparator: shouldShowWorkspacePaneTabSeparator({
                  leftId: item.identity,
                  rightId,
                  activeId: activeVisualIdentity,
                  hoveredId: hoveredTabIdentity,
                }),
                onHoverChange,
                onSelect,
                onClose,
                onKeyDown,
                t,
                interactionDisabled: tabInteractionBlocked,
                compact: false,
              }
              if (!isSortableWorkspacePaneTabItem(item)) {
                return <WorkspacePaneTab key={item.identity} {...commonProps} />
              }
              return (
                <SortableWorkspacePaneTab key={item.identity} {...commonProps} sortableIdentity={item.sortableId} />
              )
            })}
          </WorkspacePaneTabTooltipLayer>
        </SortableContext>
        {createAction ? (
          <WorkspacePaneNewButton
            ref={newButtonRef}
            id={items.length === 0 ? `${workspacePaneId}-workspace-pane-tab-empty` : undefined}
            action={createAction}
          />
        ) : null}
      </ToolbarTabStripBody>
    </DndContext>
  )
}

function shouldShowWorkspacePaneTabSeparator({
  leftId,
  rightId,
  activeId,
  hoveredId,
}: {
  leftId: string
  rightId: string | undefined
  activeId: string | null
  hoveredId: string | null
}): boolean {
  return !!rightId && leftId !== activeId && rightId !== activeId && leftId !== hoveredId && rightId !== hoveredId
}
