import { ChevronsUp, ChevronsDown, Square } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'

interface MobileTerminalToolbarProps {
  onInput: (data: string) => void
  onScrollLines?: (amount: number) => void
  disabled?: boolean
  className?: string
}

type ToolbarKey =
  | { type: 'input'; label: string; value: string; accessibleName: string }
  | { type: 'scroll'; icon: React.ReactNode; amount: number; accessibleName: string }
  | { type: 'command'; icon: React.ReactNode; value: string; accessibleName: string }
const KEYS: ToolbarKey[] = [
  { type: 'input', label: '⎋', value: '\x1b', accessibleName: 'Escape' },
  { type: 'input', label: '⇥', value: '\t', accessibleName: 'Tab' },
  { type: 'command', icon: <CtrlCIcon />, value: '\x03', accessibleName: 'Ctrl+C' },
  { type: 'scroll', icon: <ChevronsUp className="size-4" />, amount: -12, accessibleName: 'Page Up (scroll up)' },
  { type: 'scroll', icon: <ChevronsDown className="size-4" />, amount: 12, accessibleName: 'Page Down (scroll down)' },
]

export function MobileTerminalToolbar({ onInput, onScrollLines, disabled, className }: MobileTerminalToolbarProps) {
  return (
    <div className={cn('goblin-terminal-mobile-toolbar', className)} role="toolbar" aria-label="Terminal input helpers">
      <div className="goblin-terminal-mobile-toolbar__row">
        {KEYS.map((key, index) => {
          return (
            <Button
              key={index}
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
              className="goblin-terminal-mobile-toolbar__btn"
              onClick={() => {
                if (key.type === 'scroll') {
                  onScrollLines?.(key.amount)
                  return
                }
                onInput(key.value)
              }}
            >
              <span aria-hidden="true">{key.type === 'scroll' || key.type === 'command' ? key.icon : key.label}</span>
              <span className="sr-only">{key.accessibleName}</span>
            </Button>
          )
        })}
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
