import type { ReactNode } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  ClipboardPaste,
  Square,
} from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import type { TerminalVirtualKey } from '#/web/components/terminal/types.ts'

export interface MobileTerminalToolbarLabels {
  toolbar: string
  tab: string
  arrowUp: string
  arrowDown: string
  arrowLeft: string
  arrowRight: string
  escape: string
  ctrlC: string
  paste: string
  pageUp: string
  pageDown: string
}

interface MobileTerminalToolbarProps {
  labels: MobileTerminalToolbarLabels
  onVirtualKey: (key: TerminalVirtualKey) => void
  onPaste: () => void
  onRequestFocus: () => void
  onScrollLines: (amount: number) => void
  disabled?: boolean
  className?: string
}

type AccessibleName = Exclude<keyof MobileTerminalToolbarLabels, 'toolbar'>
type ToolbarKey = { accessibleName: AccessibleName; compactPriority?: 'low' | 'horizontal-arrow' } & (
  | { type: 'virtual-key'; label: string; key: TerminalVirtualKey }
  | { type: 'virtual-key'; icon: ReactNode; key: TerminalVirtualKey }
  | { type: 'paste'; icon: ReactNode }
  | { type: 'scroll'; icon: ReactNode; amount: number }
)

const KEY_GROUPS: Array<{ id: string; keys: ToolbarKey[] }> = [
  {
    id: 'navigation',
    keys: [
      { type: 'virtual-key', label: '⇥', key: 'tab', accessibleName: 'tab', compactPriority: 'low' },
      {
        type: 'virtual-key',
        icon: <ArrowUp className="size-4" />,
        key: 'arrow-up',
        accessibleName: 'arrowUp',
      },
      {
        type: 'virtual-key',
        icon: <ArrowDown className="size-4" />,
        key: 'arrow-down',
        accessibleName: 'arrowDown',
      },
      {
        type: 'virtual-key',
        icon: <ArrowLeft className="size-4" />,
        key: 'arrow-left',
        accessibleName: 'arrowLeft',
        compactPriority: 'horizontal-arrow',
      },
      {
        type: 'virtual-key',
        icon: <ArrowRight className="size-4" />,
        key: 'arrow-right',
        accessibleName: 'arrowRight',
        compactPriority: 'horizontal-arrow',
      },
    ],
  },
  {
    id: 'terminal-actions',
    keys: [
      { type: 'virtual-key', label: '⎋', key: 'escape', accessibleName: 'escape' },
      {
        type: 'virtual-key',
        icon: <CtrlCIcon />,
        key: 'interrupt',
        accessibleName: 'ctrlC',
      },
      {
        type: 'paste',
        icon: <ClipboardPaste className="size-4" />,
        accessibleName: 'paste',
        compactPriority: 'low',
      },
      {
        type: 'scroll',
        icon: <ChevronsUp className="size-4" />,
        amount: -12,
        accessibleName: 'pageUp',
        compactPriority: 'low',
      },
      {
        type: 'scroll',
        icon: <ChevronsDown className="size-4" />,
        amount: 12,
        accessibleName: 'pageDown',
        compactPriority: 'low',
      },
    ],
  },
]

export function MobileTerminalToolbar({
  labels,
  onVirtualKey,
  onPaste,
  onRequestFocus,
  onScrollLines,
  disabled,
  className,
}: MobileTerminalToolbarProps) {
  return (
    <div className={cn('goblin-terminal-mobile-toolbar', className)} role="group" aria-label={labels.toolbar}>
      <div className="goblin-terminal-mobile-toolbar__row">
        {KEY_GROUPS.map((group) => (
          <div key={group.id} className="goblin-terminal-mobile-toolbar__group">
            {group.keys.map((key) => (
              <Button
                key={key.accessibleName}
                type="button"
                size="icon"
                variant="secondary"
                disabled={disabled}
                // Accessible name comes from a visually-hidden span, not
                // `aria-label`: iOS Safari pops a native callout on
                // long-press of any element whose accessible name is
                // provided via `aria-label`. Visually-hidden text doesn't
                // trigger that OS-level tooltip, but screen readers still
                // announce it as the button's name.
                className={cn(
                  'goblin-terminal-mobile-toolbar__btn',
                  key.compactPriority === 'low' && 'goblin-terminal-mobile-toolbar__btn--low-priority',
                  key.compactPriority === 'horizontal-arrow' && 'goblin-terminal-mobile-toolbar__btn--horizontal-arrow',
                )}
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  if (key.type === 'paste') {
                    onPaste()
                    if (event.detail > 0) onRequestFocus()
                    return
                  }
                  if (key.type === 'scroll') {
                    onScrollLines(key.amount)
                    return
                  }
                  if (key.type === 'virtual-key') {
                    onVirtualKey(key.key)
                    if (event.detail > 0) onRequestFocus()
                    return
                  }
                }}
              >
                <span aria-hidden="true">{'label' in key ? key.label : key.icon}</span>
                <span className="sr-only">{labels[key.accessibleName]}</span>
              </Button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function CtrlCIcon() {
  return (
    <span className="relative inline-flex size-4 items-center justify-center" aria-hidden="true">
      <Square className="size-4" />
      <span className="absolute text-[8px] font-semibold leading-none">C</span>
    </span>
  )
}
