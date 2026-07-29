import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode, type Ref } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Keyboard,
  TextCursorInput,
} from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'
import { TerminalComposerMenu } from '#/web/components/terminal/terminal-composer-menu.tsx'
import type { TerminalVirtualKey } from '#/web/components/terminal/types.ts'

export interface TerminalComposerLabels {
  composer: string
  open: string
  close: string
  inputPlaceholder: string
  more: string
  uploadFiles: string
  showKeys: string
  showInput: string
  tab: string
  arrowUp: string
  arrowDown: string
  arrowLeft: string
  arrowRight: string
  escape: string
  ctrlC: string
  pageUp: string
  pageDown: string
}

interface TerminalComposerProps {
  labels: TerminalComposerLabels
  onVirtualKey: (key: TerminalVirtualKey) => void
  onSendText: (text: string) => boolean
  onResolveFiles: (files: File[]) => Promise<string | null>
  onRequestFocus: () => void
  onScrollLines: (amount: number) => void
  disabled?: boolean
  className?: string
}

type AccessibleName = Exclude<
  keyof TerminalComposerLabels,
  'composer' | 'open' | 'close' | 'inputPlaceholder' | 'more' | 'uploadFiles' | 'showKeys' | 'showInput'
>
type ComposerKeyAction = { accessibleName: AccessibleName } & (
  | { type: 'virtual-key'; icon: ReactNode; key: TerminalVirtualKey }
  | { type: 'scroll'; icon: ReactNode; amount: number }
)

const PRIMARY_KEY_ACTIONS: ComposerKeyAction[] = [
  { type: 'virtual-key', icon: <ArrowUp className="size-4" />, key: 'arrow-up', accessibleName: 'arrowUp' },
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
  },
  {
    type: 'virtual-key',
    icon: <ArrowRight className="size-4" />,
    key: 'arrow-right',
    accessibleName: 'arrowRight',
  },
  { type: 'scroll', icon: <ChevronsUp className="size-4" />, amount: -12, accessibleName: 'pageUp' },
  { type: 'scroll', icon: <ChevronsDown className="size-4" />, amount: 12, accessibleName: 'pageDown' },
]

const COMPOSER_INPUT_MIN_HEIGHT_PX = 40
const COMPOSER_INPUT_MAX_HEIGHT_PX = 120

function resizeComposerInput(input: HTMLTextAreaElement, hasContent: boolean) {
  input.style.height = `${COMPOSER_INPUT_MIN_HEIGHT_PX}px`
  if (!hasContent) return
  input.style.height = `${Math.min(COMPOSER_INPUT_MAX_HEIGHT_PX, Math.max(COMPOSER_INPUT_MIN_HEIGHT_PX, input.scrollHeight))}px`
}

function insertComposerText(value: string, insertion: string, start: number, end: number) {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trailingSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  const insertedText = `${leadingSpace}${insertion}${trailingSpace}`
  return {
    value: `${before}${insertedText}${after}`,
    caret: before.length + leadingSpace.length + insertion.length,
  }
}

export function TerminalComposer({
  labels,
  onVirtualKey,
  onSendText,
  onResolveFiles,
  onRequestFocus,
  onScrollLines,
  disabled,
  className,
}: TerminalComposerProps) {
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'input' | 'keys'>('input')
  const [draft, setDraft] = useState('')
  const [resolvingFiles, setResolvingFiles] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInsertionRef = useRef({ start: 0, end: 0 })
  const pendingCaretRef = useRef<number | null>(null)
  const composerId = useId()

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input || !expanded || mode !== 'input') return
    resizeComposerInput(input, draft.length > 0)
    const pendingCaret = pendingCaretRef.current
    if (pendingCaret !== null) {
      pendingCaretRef.current = null
      input.focus()
      input.setSelectionRange(pendingCaret, pendingCaret)
    }
  }, [draft, expanded, mode])

  useLayoutEffect(() => {
    if (expanded && mode === 'input') inputRef.current?.focus()
  }, [expanded, mode])

  useEffect(() => {
    const input = inputRef.current
    if (!input || !expanded || mode !== 'input' || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => resizeComposerInput(input, input.value.length > 0))
    observer.observe(input)
    return () => observer.disconnect()
  }, [expanded, mode])

  const submitDraft = () => {
    if (!draft || !onSendText(draft)) return
    setDraft('')
  }
  const closeComposer = () => {
    setExpanded(false)
  }
  const openFilePicker = () => {
    const input = inputRef.current
    fileInsertionRef.current = {
      start: input?.selectionStart ?? draft.length,
      end: input?.selectionEnd ?? draft.length,
    }
    fileInputRef.current?.click()
  }
  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    setResolvingFiles(true)
    try {
      const insertion = await onResolveFiles(files)
      if (!insertion) return
      setDraft((current) => {
        const start = Math.min(fileInsertionRef.current.start, current.length)
        const end = Math.min(Math.max(fileInsertionRef.current.end, start), current.length)
        const next = insertComposerText(current, insertion, start, end)
        pendingCaretRef.current = next.caret
        return next.value
      })
    } finally {
      setResolvingFiles(false)
    }
  }

  return (
    <div
      className={cn('goblin-terminal-composer', expanded && 'goblin-terminal-composer--expanded', className)}
      data-expanded={expanded}
      role="group"
      aria-label={labels.composer}
    >
      <ComposerButton
        buttonRef={triggerRef}
        className="goblin-terminal-composer__toggle"
        accessibleName={labels.open}
        disabled={disabled}
        ariaExpanded={expanded}
        ariaControls={composerId}
        ariaHidden={expanded}
        tabIndex={expanded ? -1 : undefined}
        onClick={() => setExpanded(true)}
      >
        <Keyboard className="size-5" />
      </ComposerButton>
      <div
        id={composerId}
        className="goblin-terminal-composer__surface"
        aria-hidden={!expanded}
        inert={!expanded ? true : undefined}
      >
        <div className="goblin-terminal-composer__mode-row">
          <ComposerButton
            accessibleName={mode === 'input' ? labels.showKeys : labels.showInput}
            disabled={disabled}
            onClick={() => setMode((current) => (current === 'input' ? 'keys' : 'input'))}
          >
            {mode === 'input' ? <Keyboard className="size-4" /> : <TextCursorInput className="size-4" />}
          </ComposerButton>
          {mode === 'input' ? (
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              disabled={disabled}
              aria-label={labels.inputPlaceholder}
              placeholder={labels.inputPlaceholder}
              className="goblin-terminal-composer__input"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                submitDraft()
              }}
            />
          ) : (
            <ScrollArea
              orientation="horizontal"
              scrollbarMode="compact"
              className="goblin-terminal-composer__key-scroll"
            >
              <div className="goblin-terminal-composer__key-row">
                {PRIMARY_KEY_ACTIONS.map((key) => (
                  <ComposerButton
                    key={key.accessibleName}
                    accessibleName={labels[key.accessibleName]}
                    disabled={disabled}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      if (key.type === 'scroll') {
                        onScrollLines(key.amount)
                        return
                      }
                      onVirtualKey(key.key)
                      if (event.detail > 0) onRequestFocus()
                    }}
                  >
                    {key.icon}
                  </ComposerButton>
                ))}
              </div>
            </ScrollArea>
          )}
          <input
            ref={fileInputRef}
            hidden
            tabIndex={-1}
            aria-hidden="true"
            type="file"
            multiple
            onChange={handleFileSelection}
          />
          <TerminalComposerMenu
            labels={labels}
            mode={mode}
            disabled={disabled}
            resolvingFiles={resolvingFiles}
            onUpload={openFilePicker}
            onVirtualKey={onVirtualKey}
            onRequestTerminalFocus={onRequestFocus}
            onClose={closeComposer}
            onRestoreComposerTriggerFocus={() => triggerRef.current?.focus()}
          />
        </div>
      </div>
    </div>
  )
}

interface ComposerButtonProps {
  accessibleName: string
  children: ReactNode
  buttonRef?: Ref<HTMLButtonElement>
  className?: string
  disabled?: boolean
  ariaExpanded?: boolean
  ariaControls?: string
  ariaHidden?: boolean
  tabIndex?: number
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
}

function ComposerButton({
  accessibleName,
  children,
  buttonRef,
  className,
  disabled,
  ariaExpanded,
  ariaControls,
  ariaHidden,
  tabIndex,
  onClick,
  onPointerDown,
}: ComposerButtonProps) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      size="icon"
      variant="secondary"
      disabled={disabled}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-hidden={ariaHidden}
      tabIndex={tabIndex}
      className={cn('goblin-terminal-composer__btn', className)}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{accessibleName}</span>
    </Button>
  )
}
