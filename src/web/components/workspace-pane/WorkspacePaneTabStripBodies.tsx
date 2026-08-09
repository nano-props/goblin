import { DragDropProvider } from '@dnd-kit/vue'
import type { FunctionalComponent, Ref } from 'vue'
import { ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { isSortableWorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-dnd.ts'
import type { WorkspacePaneTabDnd } from '#/web/components/workspace-pane/workspace-pane-tab-dnd.ts'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import {
  SortableWorkspacePaneTab,
  WorkspacePaneNewButton,
  WorkspacePaneTab,
  WorkspacePaneTabSwitcherPopover,
} from '#/web/components/workspace-pane/WorkspacePaneTabPresentation.tsx'
import type {
  WorkspacePaneT,
  WorkspacePaneTabCreateAction,
  WorkspacePaneTabProps,
} from '#/web/components/workspace-pane/WorkspacePaneTabPresentation.tsx'
import { WorkspacePaneTabTooltipLayer } from '#/web/components/workspace-pane/WorkspacePaneTabTooltipLayer.tsx'
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
  onClose: (identity: string) => void
  onKeyDown: (event: KeyboardEvent, identity: string) => void
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

export const WorkspacePaneCompactTabsBody: FunctionalComponent<WorkspacePaneCompactTabsBodyProps> = (props) => {
  const context = props.context
  // Compact tabs intentionally use muted chrome even when selected, so
  // selection should not suppress separators; hover still does.
  const compactActiveVisualIdentity = null
  const item = props.compactItem

  return (
    <ToolbarTabStripBody class="flex-1">
      <WorkspacePaneTabTooltipLayer
        items={props.items}
        role="tablist"
        aria-label={context.t('workspace-pane-tabs.tabs')}
        class="flex-1"
      >
        {item ? (
          <WorkspacePaneTab
            item={item}
            isActive={!!context.panelActive && item.identity === context.activeTabIdentity}
            isSelected={item.identity === context.activeTabIdentity}
            isFocusable={item.identity === context.focusableTabIdentity}
            tabId={
              item.kind === 'runtime'
                ? workspacePaneRuntimeTabProvider(item.runtimeType).buttonId(props.workspacePaneId, 0)
                : context.tabIdForItem(item)
            }
            focusRegistry={context.focusRegistry}
            onSelect={context.onSelect}
            onClose={context.onClose}
            onKeyDown={context.onKeyDown}
            t={context.t}
            interactionDisabled={context.tabInteractionBlocked}
            compact
            showSeparator={shouldShowWorkspacePaneTabSeparator({
              leftId: item.identity,
              rightId: WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID,
              activeId: compactActiveVisualIdentity,
              hoveredId: context.hoveredTabIdentity,
            })}
            onHoverChange={context.onHoverChange}
          />
        ) : null}
      </WorkspacePaneTabTooltipLayer>
      <WorkspacePaneTabSwitcherPopover
        items={props.items}
        activeTabIdentity={context.activeTabIdentity}
        label={context.t('workspace-pane-tabs.tabs')}
        createAction={props.createAction}
        tabInteractionBlocked={context.tabInteractionBlocked}
        onSelect={context.onSelect}
        onClose={context.onClose}
        t={context.t}
      />
    </ToolbarTabStripBody>
  )
}

WorkspacePaneCompactTabsBody.props = ['items', 'compactItem', 'workspacePaneId', 'context', 'createAction']

interface WorkspacePaneScrollableTabsBodyProps extends WorkspacePaneTabBodyCommonProps {
  createAction: WorkspacePaneTabCreateAction | null
  newButtonRef: Ref<HTMLButtonElement | null>
  workspacePaneId: string
  dnd: WorkspacePaneTabDnd
}

export const WorkspacePaneScrollableTabsBody: FunctionalComponent<WorkspacePaneScrollableTabsBodyProps> = (props) => {
  const context = props.context
  const activeVisualIdentity = context.panelActive ? context.activeTabIdentity : null
  const sortableIndices = new Map(
    props.items.filter(isSortableWorkspacePaneTabItem).map((item, index) => [item.identity, index]),
  )

  return (
    <DragDropProvider
      modifiers={props.dnd.modifiers}
      plugins={props.dnd.plugins}
      sensors={props.dnd.sensors}
      onDragEnd={props.dnd.handleDragEnd}
    >
      <ToolbarTabStripBody scroll>
        <WorkspacePaneTabTooltipLayer
          items={props.items}
          role="tablist"
          aria-label={context.t('workspace-pane-tabs.tabs')}
        >
          {props.items.map((item, index) => {
            const nextItem = props.items[index + 1]
            const rightId = nextItem ? nextItem.identity : WORKSPACE_PANE_NEW_ACTION_ID
            const commonProps: WorkspacePaneTabProps = {
              item,
              isActive: !!context.panelActive && item.identity === context.activeTabIdentity,
              isSelected: item.identity === context.activeTabIdentity,
              isFocusable: item.identity === context.focusableTabIdentity,
              index,
              total: props.items.length,
              tabId: context.tabIdForItem(item),
              focusRegistry: context.focusRegistry,
              showSeparator: shouldShowWorkspacePaneTabSeparator({
                leftId: item.identity,
                rightId,
                activeId: activeVisualIdentity,
                hoveredId: context.hoveredTabIdentity,
              }),
              onHoverChange: context.onHoverChange,
              onSelect: context.onSelect,
              onClose: context.onClose,
              onKeyDown: context.onKeyDown,
              t: context.t,
              interactionDisabled: context.tabInteractionBlocked,
              compact: false,
            }
            if (!isSortableWorkspacePaneTabItem(item)) {
              return <WorkspacePaneTab key={item.identity} {...commonProps} />
            }
            const sortableIndex = sortableIndices.get(item.identity)
            if (sortableIndex === undefined) return null
            return (
              <SortableWorkspacePaneTab
                key={item.identity}
                {...commonProps}
                sortableIdentity={item.sortableId}
                sortableIndex={sortableIndex}
              />
            )
          })}
        </WorkspacePaneTabTooltipLayer>
        {props.createAction ? (
          <WorkspacePaneNewButton
            buttonRef={props.newButtonRef}
            id={props.items.length === 0 ? `${props.workspacePaneId}-workspace-pane-tab-empty` : undefined}
            action={props.createAction}
          />
        ) : null}
      </ToolbarTabStripBody>
    </DragDropProvider>
  )
}

WorkspacePaneScrollableTabsBody.props = ['items', 'context', 'createAction', 'newButtonRef', 'workspacePaneId', 'dnd']

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
