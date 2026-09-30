import { defineComponent } from 'vue'
import type { CSSProperties, HTMLAttributes } from 'vue'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { cn } from '#/web/lib/cn.ts'

const WORKSPACE_TOOLBAR_STYLE = { height: `${TITLE_BAR_HEIGHT_PX}px` } satisfies CSSProperties
const WORKSPACE_TOOLBAR_BASE_CLASS =
  'goblin-workspace-toolbar flex min-w-0 shrink-0 items-center justify-between gap-0 border-b border-border/60 bg-card'

interface WorkspaceToolbarChromeOptions {
  expanded?: boolean
  navigationOffset?: boolean
}

function workspaceToolbarClass({ expanded = true }: Pick<WorkspaceToolbarChromeOptions, 'expanded'> = {}) {
  return cn(WORKSPACE_TOOLBAR_BASE_CLASS, !expanded && 'goblin-workspace-toolbar--compact')
}

export const WorkspaceToolbar = defineComponent<WorkspaceToolbarChromeOptions>({
  name: 'WorkspaceToolbar',
  props: ['expanded', 'navigationOffset'],
  inheritAttrs: false,

  setup(props, { attrs, slots }) {
    return () => {
      const { class: classValue, style, ...elementAttrs } = attrs as HTMLAttributes
      const toolbarProps: HTMLAttributes = {
        ...elementAttrs,
        class: cn(
          workspaceToolbarClass({ expanded: props.expanded }),
          props.navigationOffset && 'goblin-workspace-toolbar--navigation-offset',
          classValue,
        ),
        style: [WORKSPACE_TOOLBAR_STYLE, style],
      }
      return <div {...toolbarProps}>{slots.default?.()}</div>
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
}

export const WorkspaceToolbarLeadingSpacer = defineComponent<WorkspaceToolbarLeadingSpacerProps>({
  name: 'WorkspaceToolbarLeadingSpacer',
  props: ['reserve'],
  inheritAttrs: false,

  setup(props, { attrs }) {
    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <div
          {...elementAttrs}
          data-testid="workspace-toolbar-leading-spacer"
          class={cn(
            'goblin-workspace-toolbar__leading-spacer h-full shrink-0',
            props.reserve && 'goblin-workspace-toolbar__leading-spacer--reserved',
            classValue,
          )}
          aria-hidden
        ></div>
      )
    }
  },
})

export const WorkspaceChrome = defineComponent<WorkspaceToolbarChromeOptions>({
  name: 'WorkspaceChrome',
  props: ['expanded', 'navigationOffset'],

  setup(props) {
    return () => (
      <WorkspaceToolbar expanded={props.expanded} navigationOffset={props.navigationOffset}>
        <WorkspaceToolbarLeadingSpacer reserve={!!props.navigationOffset} />
        <WorkspaceToolbarPrimary />
      </WorkspaceToolbar>
    )
  },
})
