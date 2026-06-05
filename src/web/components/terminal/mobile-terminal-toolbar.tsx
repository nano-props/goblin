import { ChevronsUp, ChevronsDown } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'

interface MobileTerminalToolbarProps {
  onInput: (data: string) => void
  onScrollLines?: (amount: number) => void
  disabled?: boolean
  className?: string
}

type ToolbarKey =
  | { type: 'input'; label: string; value: string; title: string }
  | { type: 'scroll'; icon: React.ReactNode; amount: number; title: string }

const KEYS: ToolbarKey[] = [
  { type: 'input', label: '⎋', value: '\x1b', title: 'Escape' },
  { type: 'input', label: '⇥', value: '\t', title: 'Tab' },
  { type: 'scroll', icon: <ChevronsUp className="size-4" />, amount: -12, title: 'Page Up (scroll up)' },
  { type: 'scroll', icon: <ChevronsDown className="size-4" />, amount: 12, title: 'Page Down (scroll down)' },
]

export function MobileTerminalToolbar({ onInput, onScrollLines, disabled, className }: MobileTerminalToolbarProps) {
  return (
    <div className={cn('goblin-terminal-mobile-toolbar', className)} role="toolbar" aria-label="Terminal input helpers">
      <div className="goblin-terminal-mobile-toolbar__row">
        {KEYS.map((key, index) => (
          <Button
            key={index}
            type="button"
            size="icon"
            variant="secondary"
            title={key.title}
            disabled={disabled}
            className="goblin-terminal-mobile-toolbar__btn"
            onClick={() => {
              if (key.type === 'scroll') {
                onScrollLines?.(key.amount)
              } else {
                onInput(key.value)
              }
            }}
          >
            {key.type === 'scroll' ? key.icon : key.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
