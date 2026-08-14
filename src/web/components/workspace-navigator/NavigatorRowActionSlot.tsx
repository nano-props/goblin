import type { FunctionalComponent, VNodeChild } from 'vue'
import { TerminalBellBadge } from '#/web/terminal/components/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/terminal/components/TerminalOutputActivityIndicator.tsx'
import { NAVIGATOR_ROW_ACTION_BOX_CLASS } from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
import { cn } from '#/web/lib/cn.ts'

interface NavigatorRowActionSlotProps {
  action: VNodeChild
  actionHidden: boolean
  terminalBellCount: number
  terminalOutputActive: boolean
}

export const NavigatorRowActionSlot: FunctionalComponent<NavigatorRowActionSlotProps> = (props) => {
  const showBellBadge = props.terminalBellCount > 0 && props.actionHidden
  const showOutputActivity = props.terminalOutputActive && props.actionHidden && !showBellBadge

  return (
    <div class={NAVIGATOR_ROW_ACTION_BOX_CLASS}>
      {showBellBadge ? (
        <div class="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
          <TerminalBellBadge count={props.terminalBellCount} />
        </div>
      ) : null}
      {showOutputActivity ? (
        <div class="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
          <TerminalOutputActivityIndicator />
        </div>
      ) : null}
      <div
        class={cn(
          'relative',
          !props.actionHidden && 'pointer-events-auto',
          props.actionHidden &&
            'pointer-events-none opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
        )}
      >
        {props.action}
      </div>
    </div>
  )
}

NavigatorRowActionSlot.props = ['action', 'actionHidden', 'terminalBellCount', 'terminalOutputActive']
