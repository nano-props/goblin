import { Copy, Delete, Ellipsis, Upload, X } from 'lucide-react'
import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Separator } from '#/web/components/ui/separator.tsx'
import {
  TERMINAL_COMPOSER_COPY_ACTION,
  TERMINAL_COMPOSER_OPTIONAL_ACTIONS,
  type TerminalComposerOptionalActionLabelKey,
  type TerminalComposerOptionalVirtualKey,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'

type TerminalComposerMenuLabels = Record<TerminalComposerOptionalActionLabelKey, string> & {
  more: string
  uploadFiles: string
  copyContent: string
  close: string
}

interface TerminalComposerMenuProps {
  labels: TerminalComposerMenuLabels
  mode: 'input' | 'keys'
  resolvingFiles: boolean
  copyingContent: boolean
  onUpload: () => void
  onVirtualKey: (key: TerminalComposerOptionalVirtualKey) => void
  onCopyContent: () => void
  onClose: () => boolean
  onRestoreComposerTriggerFocus: () => void
}

type ComposerMenuCloseFocusIntent = 'popover-default' | 'preserve-existing' | 'composer-trigger'

function preventPointerFocus(event: ReactPointerEvent<HTMLElement>): void {
  event.preventDefault()
}

function preventMouseFocus(event: ReactMouseEvent<HTMLElement>): void {
  event.preventDefault()
}

export function TerminalComposerMenu({
  labels,
  mode,
  resolvingFiles,
  copyingContent,
  onUpload,
  onVirtualKey,
  onCopyContent,
  onClose,
  onRestoreComposerTriggerFocus,
}: TerminalComposerMenuProps) {
  const closeFocusIntentRef = useRef<ComposerMenuCloseFocusIntent>('popover-default')
  const [open, setOpen] = useState(false)
  const sendVirtualKey = (key: TerminalComposerOptionalVirtualKey) => {
    onVirtualKey(key)
  }
  const closeMenu = () => setOpen(false)
  const handleMoreClickCapture: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (event.detail > 0) closeFocusIntentRef.current = 'preserve-existing'
  }
  const handleCloseAutoFocus = (event: Event) => {
    const intent = closeFocusIntentRef.current
    closeFocusIntentRef.current = 'popover-default'
    if (intent === 'popover-default') return

    event.preventDefault()
    if (intent === 'composer-trigger') onRestoreComposerTriggerFocus()
  }
  const collapseComposer = () => {
    closeFocusIntentRef.current = onClose() ? 'composer-trigger' : 'preserve-existing'
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="goblin-terminal-composer__btn"
          onPointerDown={preventPointerFocus}
          onMouseDown={preventMouseFocus}
          onClickCapture={handleMoreClickCapture}
        >
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
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <ScrollArea
          className="max-h-(--radix-popover-content-available-height)"
          viewportClassName="p-1"
          scrollbarMode="compact"
        >
          <ComposerMenuItem disabled={copyingContent} onClick={onCopyContent} closeMenu={closeMenu}>
            <span aria-hidden="true" className="inline-flex w-6 shrink-0 items-center justify-center">
              <Copy className="size-4" />
            </span>
            {labels[TERMINAL_COMPOSER_COPY_ACTION.labelKey]}
          </ComposerMenuItem>
          <Separator className="-mx-1 my-1 w-auto" />
          {mode === 'input' ? (
            <ComposerMenuItem disabled={resolvingFiles} onClick={onUpload} closeMenu={closeMenu}>
              <Upload className="size-4" />
              {labels.uploadFiles}
            </ComposerMenuItem>
          ) : (
            TERMINAL_COMPOSER_OPTIONAL_ACTIONS.map((action) => (
              <ComposerMenuItem
                key={action.key}
                onClick={() => sendVirtualKey(action.key)}
                closeMenu={closeMenu}
              >
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
          <ComposerMenuItem onClick={collapseComposer} closeMenu={closeMenu}>
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
  ...buttonProps
}: {
  children: ReactNode
  closeMenu: () => void
  disabled?: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation()
    closeMenu()
    onClick(event)
  }
  return (
    <button
      type="button"
      {...buttonProps}
      onPointerDown={preventPointerFocus}
      onMouseDown={preventMouseFocus}
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
