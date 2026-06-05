import type { ComponentPropsWithoutRef } from 'react'
import { DelegatedTooltipLayer, DELEGATED_TOOLTIP_DEFAULTS } from '#/web/components/DelegatedTooltipLayer.tsx'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

interface TerminalSwitcherTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  sessions: TerminalSessionSummary[]
  delayMs?: number
}

export function TerminalSwitcherTooltipLayer({
  sessions,
  delayMs = DELEGATED_TOOLTIP_DEFAULTS.delayMs,
  children,
  ...props
}: TerminalSwitcherTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={sessions}
      selector="[data-terminal-switcher-tooltip-id]"
      attributeName="data-terminal-switcher-tooltip-id"
      getItemId={(session) => session.key}
      renderTooltip={(session) => (
        <div className="truncate px-3 py-2 text-xs font-semibold text-foreground">{session.fullTitle ?? session.title}</div>
      )}
      delayMs={delayMs}
      placement="left"
      maxWidth={360}
      tooltipClassName="max-w-[min(22rem,calc(100vw-2rem))]"
      {...props}
    >
      {children}
    </DelegatedTooltipLayer>
  )
}
