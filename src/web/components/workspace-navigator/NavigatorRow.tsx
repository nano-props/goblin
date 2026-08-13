import type { FunctionalComponent, LiHTMLAttributes, VNodeChild } from 'vue'
import {
  NAVIGATOR_ROW_ACTION_SLOT_CLASS,
  NAVIGATOR_ROW_CONTENT_CLASS,
  NAVIGATOR_ROW_GRID_CLASS,
} from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
import type { ElementRef } from '#/web/components/ui/refs.ts'
import { toLiVNodeRef } from '#/web/components/ui/refs.ts'
import { cn } from '#/web/lib/cn.ts'

interface NavigatorRowProps extends Omit<LiHTMLAttributes, 'content'> {
  selected: boolean
  content: VNodeChild
  actions: VNodeChild
  rowRef?: ElementRef<HTMLLIElement>
  contentClass?: string
}

export const NavigatorRow: FunctionalComponent<NavigatorRowProps> = (props, { attrs }) => {
  const { class: classValue, ...elementAttrs } = attrs as LiHTMLAttributes
  return (
    <li
      {...elementAttrs}
      ref={toLiVNodeRef(props.rowRef)}
      class={cn(
        NAVIGATOR_ROW_GRID_CLASS,
        'group relative cursor-pointer transition-colors duration-100',
        props.selected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
        classValue,
      )}
    >
      <div class={cn(NAVIGATOR_ROW_CONTENT_CLASS, 'pointer-events-none relative z-10', props.contentClass)}>
        {props.content}
      </div>
      <div class={cn(NAVIGATOR_ROW_ACTION_SLOT_CLASS, 'pointer-events-none relative z-20')}>{props.actions}</div>
    </li>
  )
}

NavigatorRow.props = ['selected', 'content', 'actions', 'rowRef', 'contentClass']
NavigatorRow.inheritAttrs = false
