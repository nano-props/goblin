import { defineComponent } from 'vue'
import type { CSSProperties, HTMLAttributes } from 'vue'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { TitleBarDragRegion, TitleBarNoDragRegion } from '#/web/components/title-bar-chrome-region.tsx'
import { cn } from '#/web/lib/cn.ts'

const WORKSPACE_TOOLBAR_STYLE = { height: `${TITLE_BAR_HEIGHT_PX}px` } satisfies CSSProperties
const WORKSPACE_TOOLBAR_BASE_CLASS =
  'goblin-workspace-toolbar flex min-w-0 shrink-0 items-center justify-between gap-0 border-b border-border/60 bg-card'

interface WorkspaceToolbarChromeOptions {
  draggable?: boolean
  trafficLightOffset?: boolean
}

function workspaceToolbarClass({ draggable = true }: Pick<WorkspaceToolbarChromeOptions, 'draggable'> = {}) {
  return cn(WORKSPACE_TOOLBAR_BASE_CLASS, !draggable && 'goblin-workspace-toolbar--non-draggable')
}

export const WorkspaceToolbar = defineComponent<WorkspaceToolbarChromeOptions>({
  name: 'WorkspaceToolbar',
  props: ['draggable', 'trafficLightOffset'],
  inheritAttrs: false,

  setup(props, { attrs, slots }) {
    return () => {
      const { class: classValue, style, ...elementAttrs } = attrs as HTMLAttributes
      const toolbarProps: HTMLAttributes = {
        ...elementAttrs,
        class: cn(
          workspaceToolbarClass({ draggable: props.draggable }),
          props.trafficLightOffset && 'goblin-workspace-toolbar--traffic-offset',
          classValue,
        ),
        style: [WORKSPACE_TOOLBAR_STYLE, style],
      }
      if (props.draggable === false) return <div {...toolbarProps}>{slots.default?.()}</div>
      return (
        <TitleBarDragRegion reserveWindowControls={false} {...toolbarProps}>
          {slots.default?.()}
        </TitleBarDragRegion>
      )
    }
  },
})

function toolbarSection(name: string, baseClass: string) {
  return defineComponent<HTMLAttributes>({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => {
        const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
        return (
          <div {...elementAttrs} class={cn(baseClass, classValue)}>
            {slots.default?.()}
          </div>
        )
      }
    },
  })
}

export const WorkspaceToolbarContent = toolbarSection('WorkspaceToolbarContent', 'goblin-workspace-toolbar__content')

export const WorkspaceToolbarPrimary = toolbarSection('WorkspaceToolbarPrimary', 'goblin-workspace-toolbar__primary')

export const WorkspaceToolbarActions = toolbarSection('WorkspaceToolbarActions', 'goblin-workspace-toolbar__actions')

interface WorkspaceToolbarLeadingSpacerProps {
  reserve: boolean
  noDrag?: boolean
}

export const WorkspaceToolbarLeadingSpacer = defineComponent<WorkspaceToolbarLeadingSpacerProps>({
  name: 'WorkspaceToolbarLeadingSpacer',
  props: ['reserve', 'noDrag'],
  inheritAttrs: false,

  setup(props, { attrs }) {
    return () => {
      const noDrag = props.noDrag ?? props.reserve
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <div
          {...elementAttrs}
          data-testid="workspace-toolbar-leading-spacer"
          class={cn(
            'goblin-workspace-toolbar__leading-spacer h-full shrink-0',
            props.reserve && 'goblin-workspace-toolbar__leading-spacer--reserved',
            noDrag && 'relative',
            classValue,
          )}
          aria-hidden
        >
          {noDrag ? (
            <TitleBarNoDragRegion
              data-testid="workspace-toolbar-leading-no-drag"
              class="absolute left-0 top-1/2 size-8 -translate-y-1/2"
            />
          ) : null}
        </div>
      )
    }
  },
})

export const WorkspaceChrome = defineComponent<WorkspaceToolbarChromeOptions>({
  name: 'WorkspaceChrome',
  props: ['draggable', 'trafficLightOffset'],

  setup(props) {
    return () => (
      <WorkspaceToolbar draggable={props.draggable} trafficLightOffset={props.trafficLightOffset}>
        <WorkspaceToolbarLeadingSpacer reserve={!!props.trafficLightOffset} />
        <WorkspaceToolbarPrimary />
      </WorkspaceToolbar>
    )
  },
})
