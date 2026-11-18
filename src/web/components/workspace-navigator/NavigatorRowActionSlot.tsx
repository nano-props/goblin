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
  const indicator = !props.actionHidden ? null : props.terminalBellCount > 0 ? (
    <TerminalBellBadge count={props.terminalBellCount} />
  ) : props.terminalOutputActive ? (
    <TerminalOutputActivityIndicator />
  ) : null

  return (
    <div class={NAVIGATOR_ROW_ACTION_BOX_CLASS}>
      {indicator ? (
        <div class="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover/navigator-row:opacity-0 group-has-[:focus-visible]/navigator-row:opacity-0">
          {indicator}
        </div>
      ) : null}
      <div
        class={cn(
          'relative transition-opacity duration-100',
          props.actionHidden
            ? 'pointer-events-none opacity-0 group-hover/navigator-row:pointer-events-auto group-hover/navigator-row:opacity-100 group-has-[:focus-visible]/navigator-row:pointer-events-auto group-has-[:focus-visible]/navigator-row:opacity-100'
            : 'pointer-events-auto opacity-100',
        )}
      >
        {props.action}
      </div>
    </div>
  )
}

NavigatorRowActionSlot.props = ['action', 'actionHidden', 'terminalBellCount', 'terminalOutputActive']
