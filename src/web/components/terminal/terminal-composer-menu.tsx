import { Ellipsis, Upload, X } from 'lucide-react'
import { Fragment, useRef } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import {
  TERMINAL_COMPOSER_COMMAND_KEY_GROUPS,
  type TerminalComposerCommandKeyName,
  type TerminalComposerCommandLabelKey,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'

type TerminalComposerMenuLabels = Record<TerminalComposerCommandLabelKey, string> & {
  more: string
  uploadFiles: string
  close: string
}

interface TerminalComposerMenuProps {
  labels: TerminalComposerMenuLabels
  mode: 'input' | 'keys'
  resolvingFiles: boolean
  onUpload: () => void
  onVirtualKey: (key: TerminalComposerCommandKeyName) => void
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
  const sendVirtualKey = (key: TerminalComposerCommandKeyName) => {
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
            {TERMINAL_COMPOSER_COMMAND_KEY_GROUPS.map((group, groupIndex) => (
              <Fragment key={group.id}>
                {groupIndex > 0 && <DropdownMenuSeparator />}
                {group.keys.map((action) => (
                  <DropdownMenuItem key={action.key} onSelect={() => sendVirtualKey(action.key)}>
                    <Keycap>{action.keycap}</Keycap>
                    {labels[action.labelKey]}
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
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
