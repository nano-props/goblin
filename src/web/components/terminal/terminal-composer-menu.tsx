import { Ellipsis, Upload, X } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'

interface TerminalComposerMenuLabels {
  more: string
  uploadFiles: string
  close: string
  enter: string
  backspace: string
  tab: string
  escape: string
  ctrlC: string
  ctrlD: string
}

interface TerminalComposerMenuProps {
  labels: TerminalComposerMenuLabels
  mode: 'input' | 'keys'
  resolvingFiles: boolean
  onUpload: () => void
  onVirtualKey: (key: 'enter' | 'backspace' | 'tab' | 'escape' | 'interrupt' | 'eof') => void
  onRequestTerminalFocus: () => void
  onClose: () => void
  onRestoreComposerTriggerFocus: () => void
}

export function TerminalComposerMenu({
  labels,
  mode,
  resolvingFiles,
  onUpload,
  onVirtualKey,
  onRequestTerminalFocus,
  onClose,
  onRestoreComposerTriggerFocus,
}: TerminalComposerMenuProps) {
  const focusTargetRef = useRef<'composer-trigger' | 'terminal' | null>(null)
  const sendVirtualKey = (key: 'enter' | 'backspace' | 'tab' | 'escape' | 'interrupt' | 'eof') => {
    focusTargetRef.current = 'terminal'
    onVirtualKey(key)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="secondary" className="goblin-terminal-composer__btn">
          <span aria-hidden="true">
            <Ellipsis className="size-4" />
          </span>
          <span className="sr-only">{labels.more}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="w-max min-w-32"
        onCloseAutoFocus={(event) => {
          const focusTarget = focusTargetRef.current
          if (!focusTarget) return
          focusTargetRef.current = null
          event.preventDefault()
          if (focusTarget === 'terminal') {
            onRequestTerminalFocus()
            return
          }
          onRestoreComposerTriggerFocus()
        }}
      >
        {mode === 'input' ? (
          <DropdownMenuItem disabled={resolvingFiles} onSelect={onUpload}>
            <Upload className="size-4" />
            {labels.uploadFiles}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => sendVirtualKey('enter')}>
              <Keycap>↵</Keycap>
              {labels.enter}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('backspace')}>
              <Keycap>⌫</Keycap>
              {labels.backspace}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('tab')}>
              <Keycap>⇥</Keycap>
              {labels.tab}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => sendVirtualKey('escape')}>
              <Keycap>Esc</Keycap>
              {labels.escape}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('interrupt')}>
              <Keycap>^C</Keycap>
              {labels.ctrlC}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('eof')}>
              <Keycap>^D</Keycap>
              {labels.ctrlD}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            focusTargetRef.current = 'composer-trigger'
            onClose()
          }}
        >
          <X className="size-4" />
          {labels.close}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
