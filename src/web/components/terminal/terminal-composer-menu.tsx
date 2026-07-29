import { CornerDownLeft, Delete, Ellipsis, Square, Upload, X } from 'lucide-react'
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
  disabled?: boolean
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
  disabled,
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          disabled={disabled}
          className="goblin-terminal-composer__btn"
        >
          <span aria-hidden="true">
            <Ellipsis className="size-4" />
          </span>
          <span className="sr-only">{labels.more}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
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
          <DropdownMenuItem disabled={disabled || resolvingFiles} onSelect={onUpload}>
            <Upload className="size-4" />
            {labels.uploadFiles}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => sendVirtualKey('enter')}>
              <CornerDownLeft className="size-4" />
              {labels.enter}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('backspace')}>
              <Delete className="size-4" />
              {labels.backspace}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('tab')}>
              <span aria-hidden="true">⇥</span>
              {labels.tab}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => sendVirtualKey('escape')}>
              <span aria-hidden="true">⎋</span>
              {labels.escape}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('interrupt')}>
              <CtrlCIcon />
              {labels.ctrlC}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sendVirtualKey('eof')}>
              <ControlKeyIcon letter="D" />
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

function CtrlCIcon() {
  return <ControlKeyIcon letter="C" />
}

function ControlKeyIcon({ letter }: { letter: string }) {
  return (
    <span className="relative inline-flex size-4 items-center justify-center" aria-hidden="true">
      <Square className="size-4" />
      <span className="absolute text-[8px] font-semibold leading-none">{letter}</span>
    </span>
  )
}
