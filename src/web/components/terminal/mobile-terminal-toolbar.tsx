import { ChevronsUp, ChevronsDown, ClipboardPaste, Square } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'

interface MobileTerminalToolbarProps {
  onInput: (data: string) => void
  onPaste?: () => void | Promise<void>
  onScrollLines?: (amount: number) => void
  disabled?: boolean
  className?: string
}

type ToolbarKey =
  | { type: 'input'; label: string; value: string; title: string }
  | { type: 'scroll'; icon: React.ReactNode; amount: number; title: string }
  | { type: 'command'; icon: React.ReactNode; value: string; title: string }
  | { type: 'paste'; icon: React.ReactNode; title: string }
const KEYS: ToolbarKey[] = [
  { type: 'input', label: '⎋', value: '\x1b', title: 'Escape' },
  { type: 'input', label: '⇥', value: '\t', title: 'Tab' },
  { type: 'command', icon: <CtrlCIcon />, value: '\x03', title: 'Ctrl+C' },
  { type: 'paste', icon: <ClipboardPaste className="size-4" />, title: 'Paste' },
  { type: 'scroll', icon: <ChevronsUp className="size-4" />, amount: -12, title: 'Page Up (scroll up)' },
  { type: 'scroll', icon: <ChevronsDown className="size-4" />, amount: 12, title: 'Page Down (scroll down)' },
]

export function MobileTerminalToolbar({
  onInput,
  onPaste,
  onScrollLines,
  disabled,
  className,
}: MobileTerminalToolbarProps) {
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
              aria-label={key.title}
              // No `title` attribute: this toolbar only renders on
              // touch devices, where Safari shows a native callout on
              // long-press of any element with a title. `aria-label`
              // is the right surface for the description.
              className="goblin-terminal-mobile-toolbar__btn"
              onClick={() => {
                if (key.type === 'scroll') {
                  onScrollLines?.(key.amount)
                  return
                }
                if (key.type === 'paste') {
                  void onPaste?.()
                  return
                }
                if (key.type === 'command') {
                  onInput(key.value)
                  return
                }
                onInput(key.value)
              }}
            >
              {key.type === 'scroll' || key.type === 'command' || key.type === 'paste' ? key.icon : key.label}
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
