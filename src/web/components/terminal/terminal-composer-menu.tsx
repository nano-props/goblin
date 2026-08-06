import { Delete, Ellipsis, Upload, X } from 'lucide-react'
import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Separator } from '#/web/components/ui/separator.tsx'
import {
  TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS,
  type TerminalComposerMenuCommandKeyName,
  type TerminalComposerMenuCommandLabelKey,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'

type TerminalComposerMenuLabels = Record<TerminalComposerMenuCommandLabelKey, string> & {
  more: string
  uploadFiles: string
  close: string
}

interface TerminalComposerMenuProps {
  labels: TerminalComposerMenuLabels
  mode: 'input' | 'keys'
  resolvingFiles: boolean
  onUpload: () => void
  onVirtualKey: (key: TerminalComposerMenuCommandKeyName) => void
  onClose: () => void
  onRestoreComposerTriggerFocus: () => void
}

export function TerminalComposerMenu({
  labels,
  mode,
  resolvingFiles,
  onUpload,
  onVirtualKey,
  onClose,
  onRestoreComposerTriggerFocus,
}: TerminalComposerMenuProps) {
  const restoreComposerTriggerFocusRef = useRef(false)
  const [open, setOpen] = useState(false)
  const sendVirtualKey = (key: TerminalComposerMenuCommandKeyName) => {
    onVirtualKey(key)
  }
  const closeMenu = () => setOpen(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="secondary" className="goblin-terminal-composer__btn">
          <span aria-hidden="true">
            <Ellipsis className="size-4" />
          </span>
          <span className="sr-only">{labels.more}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-max min-w-32 max-w-72 overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (!restoreComposerTriggerFocusRef.current) return
          restoreComposerTriggerFocusRef.current = false
          event.preventDefault()
          onRestoreComposerTriggerFocus()
        }}
      >
        <ScrollArea
          className="max-h-(--radix-popover-content-available-height)"
          viewportClassName="p-1"
          scrollbarMode="compact"
        >
          {mode === 'input' ? (
            <ComposerMenuItem disabled={resolvingFiles} onClick={onUpload} closeMenu={closeMenu}>
              <Upload className="size-4" />
              {labels.uploadFiles}
            </ComposerMenuItem>
          ) : (
            TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS.map((action) => (
              <ComposerMenuItem key={action.key} onClick={() => sendVirtualKey(action.key)} closeMenu={closeMenu}>
                {action.key === 'backspace' ? (
                  <span aria-hidden="true" className="inline-flex w-6 shrink-0 items-center justify-center">
                    <Delete className="size-4" />
                  </span>
                ) : (
                  <Keycap>{action.keycap}</Keycap>
                )}
                {labels[action.labelKey]}
              </ComposerMenuItem>
            ))
          )}
          <Separator className="-mx-1 my-1 w-auto" />
          <ComposerMenuItem
            onClick={() => {
              restoreComposerTriggerFocusRef.current = true
              onClose()
            }}
            closeMenu={closeMenu}
          >
            <X className="size-4" />
            {labels.close}
          </ComposerMenuItem>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function ComposerMenuItem({
  children,
  closeMenu,
  onClick,
  disabled,
}: {
  children: ReactNode
  closeMenu: () => void
  onClick: () => void
  disabled?: boolean
}) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    closeMenu()
    onClick()
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      className="group relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      {children}
    </button>
  )
}

function Keycap({ children }: { children: string }) {
  return (
    <kbd
      data-terminal-composer-keycap=""
      aria-hidden="true"
      className="inline-flex h-[18px] w-6 shrink-0 items-center justify-center rounded-[4px] border border-border bg-muted/40 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-xs"
    >
      {children}
    </kbd>
  )
}
