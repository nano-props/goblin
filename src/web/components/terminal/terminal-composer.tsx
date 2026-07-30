import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  CornerDownLeft,
  Delete,
  Keyboard,
  TextCursorInput,
} from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'
import { TerminalComposerMenu } from '#/web/components/terminal/terminal-composer-menu.tsx'
import { TerminalComposerHistoryCursor } from '#/web/components/terminal/terminal-composer-history-cursor.ts'
import {
  TERMINAL_COMPOSER_COMMAND_KEYS,
  type TerminalComposerCommandLabelKey,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'
import { isImeOwnedKeyboardEvent } from '#/web/components/terminal/terminal-keyboard.ts'
import type { TerminalComposerMode, TerminalVirtualKey } from '#/web/components/terminal/types.ts'

export interface TerminalComposerLabels {
  composer: string
  open: string
  close: string
  inputPlaceholder: string
  more: string
  uploadFiles: string
  showKeys: string
  showInput: string
  enter: string
  backspace: string
  tab: string
  arrowUp: string
  arrowDown: string
  arrowLeft: string
  arrowRight: string
  escape: string
  ctrlC: string
  ctrlD: string
  pageUp: string
  pageDown: string
}

interface TerminalComposerProps {
  ref?: Ref<TerminalComposerHandle>
  labels: TerminalComposerLabels
  expanded: boolean
  mode: TerminalComposerMode
  historyEntries: readonly string[]
  shortcut: string
  onVirtualKey: (key: TerminalVirtualKey) => void
  onSendText: (text: string) => Promise<boolean>
  onExpandedChange: (expanded: boolean) => boolean
  onModeChange: (mode: TerminalComposerMode) => boolean
  onResolveFiles: (files: File[]) => Promise<string | null>
  onRequestFocus: () => void
  onScrollLines: (amount: number) => void
  hidden?: boolean
  className?: string
}

export interface TerminalComposerHandle {
  focus(): void
}

type AccessibleName = Exclude<
  keyof TerminalComposerLabels,
  'composer' | 'open' | 'close' | 'inputPlaceholder' | 'more' | 'uploadFiles' | 'showKeys' | 'showInput'
>
type PrimaryKeyAction = { accessibleName: AccessibleName } & (
  | { type: 'virtual-key'; icon: ReactNode; key: TerminalVirtualKey }
  | { type: 'scroll'; icon: ReactNode; amount: number }
)

const PRIMARY_KEY_ACTIONS: PrimaryKeyAction[] = [
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

const COMMAND_KEY_ICONS: Partial<Record<TerminalComposerCommandLabelKey, ReactNode>> = {
  enter: <CornerDownLeft className="size-4" />,
  backspace: <Delete className="size-4" />,
}

const COMPOSER_INPUT_MIN_HEIGHT_PX = 40
const COMPOSER_INPUT_MAX_HEIGHT_PX = 160

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

function isImeCompositionEvent(event: KeyboardEvent<HTMLElement>) {
  return isImeOwnedKeyboardEvent(event.nativeEvent)
}

export function TerminalComposer({
  ref,
  labels,
  expanded,
  mode,
  historyEntries,
  shortcut,
  onVirtualKey,
  onSendText,
  onExpandedChange,
  onModeChange,
  onResolveFiles,
  onRequestFocus,
  onScrollLines,
  hidden,
  className,
}: TerminalComposerProps) {
  const [draft, setDraft] = useState('')
  const [resolvingFiles, setResolvingFiles] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const modeToggleRef = useRef<HTMLButtonElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInsertionRef = useRef({ start: 0, end: 0 })
  const pendingCaretRef = useRef<number | null>(null)
  const pendingFocusRef = useRef<'control' | 'trigger' | null>(null)
  const [history] = useState(() => new TerminalComposerHistoryCursor())
  const composerId = useId()

  const focusComposerControl = () => {
    if (mode === 'input') inputRef.current?.focus()
    else modeToggleRef.current?.focus()
  }
  const requestComposerFocus = () => {
    pendingFocusRef.current = 'control'
    if (!expanded || hidden) return
    pendingFocusRef.current = null
    focusComposerControl()
  }
  const requestComposerFocusAfterUpdate = () => {
    pendingFocusRef.current = 'control'
  }
  const requestTriggerFocus = () => {
    pendingFocusRef.current = 'trigger'
    if (expanded) return
    pendingFocusRef.current = null
    triggerRef.current?.focus()
  }

  useImperativeHandle(ref, () => ({ focus: requestComposerFocus }))

  useLayoutEffect(() => {
    history.updateEntries(historyEntries)
  }, [history, historyEntries])

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
    if (hidden) {
      pendingFocusRef.current = null
      return
    }
    if (pendingFocusRef.current === 'control' && expanded) {
      pendingFocusRef.current = null
      focusComposerControl()
      return
    }
    if (pendingFocusRef.current === 'trigger' && !expanded) {
      pendingFocusRef.current = null
      triggerRef.current?.focus()
    }
  }, [expanded, hidden, mode])

  useEffect(() => {
    const input = inputRef.current
    if (!input || !expanded || mode !== 'input' || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => resizeComposerInput(input, input.value.length > 0))
    observer.observe(input)
    return () => observer.disconnect()
  }, [expanded, mode])

  const submitDraft = async () => {
    if (!draft || resolvingFiles) return
    const submittedDraft = draft
    if (!(await onSendText(submittedDraft))) return
    history.leaveBrowsing()
    setDraft((current) => (current === submittedDraft ? '' : current))
  }
  const closeComposer = () => {
    if (!onExpandedChange(false)) return
    requestTriggerFocus()
  }
  const currentFileInsertion = () => {
    const input = inputRef.current
    return {
      start: input?.selectionStart ?? draft.length,
      end: input?.selectionEnd ?? draft.length,
    }
  }
  const openFilePicker = () => {
    fileInsertionRef.current = currentFileInsertion()
    fileInputRef.current?.click()
  }
  const resolveFilesIntoDraft = async (files: File[], insertionRange: { start: number; end: number }) => {
    if (files.length === 0 || resolvingFiles) return
    setResolvingFiles(true)
    try {
      const insertion = await onResolveFiles(files)
      if (!insertion) return
      history.leaveBrowsing()
      setDraft((current) => {
        const start = Math.min(insertionRange.start, current.length)
        const end = Math.min(Math.max(insertionRange.end, start), current.length)
        const next = insertComposerText(current, insertion, start, end)
        pendingCaretRef.current = next.caret
        return next.value
      })
    } finally {
      setResolvingFiles(false)
    }
  }
  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await resolveFilesIntoDraft(files, fileInsertionRef.current)
  }

  return (
    <div
      className={cn('goblin-terminal-composer', expanded && 'goblin-terminal-composer--expanded', className)}
      data-expanded={expanded}
      hidden={hidden}
      role="group"
      aria-label={labels.composer}
      onKeyDownCapture={(event) => {
        if (!expanded || event.key !== 'Escape' || isImeCompositionEvent(event)) return
        if (event.target instanceof Element && event.target.closest('[data-slot="dropdown-menu-content"]')) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        closeComposer()
      }}
    >
      <ComposerButton
        buttonRef={triggerRef}
        className="goblin-terminal-composer__toggle"
        accessibleName={labels.open}
        ariaExpanded={expanded}
        ariaControls={composerId}
        ariaHidden={expanded}
        ariaKeyShortcuts={shortcut}
        tabIndex={expanded ? -1 : undefined}
        onClick={() => {
          if (!onExpandedChange(true)) return
          requestComposerFocus()
        }}
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
            buttonRef={modeToggleRef}
            accessibleName={mode === 'input' ? labels.showKeys : labels.showInput}
            onClick={() => {
              const nextMode = mode === 'input' ? 'keys' : 'input'
              if (!onModeChange(nextMode)) return
              requestComposerFocusAfterUpdate()
            }}
          >
            {mode === 'input' ? <Keyboard className="size-4" /> : <TextCursorInput className="size-4" />}
          </ComposerButton>
          {mode === 'input' ? (
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              readOnly={resolvingFiles}
              aria-busy={resolvingFiles || undefined}
              aria-label={labels.inputPlaceholder}
              placeholder={labels.inputPlaceholder}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              className="goblin-terminal-composer__input font-mono"
              onChange={(event) => {
                history.leaveBrowsing()
                setDraft(event.target.value)
              }}
              onPointerDown={() => history.leaveBrowsing()}
              onKeyDown={(event) => {
                if (resolvingFiles || isImeCompositionEvent(event)) return
                const plainVerticalNavigation = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
                if (plainVerticalNavigation && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                  const historicalDraft = event.key === 'ArrowUp' ? history.previous(draft) : history.next()
                  if (historicalDraft !== undefined) {
                    event.preventDefault()
                    if (historicalDraft !== draft) {
                      pendingCaretRef.current = historicalDraft.length
                      setDraft(historicalDraft)
                    }
                    return
                  }
                } else if (history.isBrowsing()) {
                  history.leaveBrowsing()
                }
                if (event.key !== 'Enter' || event.shiftKey) return
                event.preventDefault()
                void submitDraft()
              }}
            />
          ) : (
            <ScrollArea
              orientation="horizontal"
              scrollbarMode="compact"
              className="goblin-terminal-composer__key-scroll"
            >
              <div className="goblin-terminal-composer__key-row">
                {TERMINAL_COMPOSER_COMMAND_KEYS.map((key, index) => (
                  <ComposerButton
                    key={key.key}
                    className={`goblin-terminal-composer__key-action--optional-${index + 1}`}
                    accessibleName={labels[key.labelKey]}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      onVirtualKey(key.key)
                      if (event.detail > 0) onRequestFocus()
                    }}
                  >
                    {COMMAND_KEY_ICONS[key.labelKey] ?? key.keycap}
                  </ComposerButton>
                ))}
                {PRIMARY_KEY_ACTIONS.map((key) => (
                  <ComposerButton
                    key={key.accessibleName}
                    accessibleName={labels[key.accessibleName]}
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
            resolvingFiles={resolvingFiles}
            onUpload={openFilePicker}
            onVirtualKey={onVirtualKey}
            onRequestTerminalFocus={onRequestFocus}
            onClose={closeComposer}
            onRestoreComposerTriggerFocus={requestTriggerFocus}
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
  ariaExpanded?: boolean
  ariaControls?: string
  ariaHidden?: boolean
  ariaKeyShortcuts?: string
  tabIndex?: number
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
}

function ComposerButton({
  accessibleName,
  children,
  buttonRef,
  className,
  ariaExpanded,
  ariaControls,
  ariaHidden,
  ariaKeyShortcuts,
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
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-hidden={ariaHidden}
      aria-keyshortcuts={ariaKeyShortcuts}
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
