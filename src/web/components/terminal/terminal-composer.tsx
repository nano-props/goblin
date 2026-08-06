import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
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
  TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS,
  TERMINAL_COMPOSER_PINNED_COMMAND_KEYS,
  type TerminalComposerCommandLabelKey,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'
import { isDesktopMacNavigatorPlatform, isImeOwnedKeyboardEvent } from '#/web/components/terminal/terminal-keyboard.ts'
import {
  draftOffsetToTextareaOffset,
  planTerminalComposerEdit,
  textareaOffsetToDraftOffset,
  terminalComposerEditCommandForEvent,
} from '#/web/components/terminal/terminal-composer-editing.ts'
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
}

interface TerminalComposerProps {
  ref?: Ref<TerminalComposerHandle>
  labels: TerminalComposerLabels
  expanded: boolean
  mode: TerminalComposerMode
  draft: string
  historyEntries: readonly string[]
  shortcut: string
  onVirtualKey: (key: TerminalVirtualKey) => void
  onSendText: (text: string) => Promise<boolean>
  onOpen: () => boolean
  onClose: () => boolean
  onModeChange: (mode: TerminalComposerMode) => boolean
  onDraftChange: (draft: string) => boolean
  onDraftReplace: (expectedDraft: string, draft: string) => boolean
  onResolveFiles: (files: File[]) => Promise<string | null>
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

interface PrimaryKeyAction {
  accessibleName: AccessibleName
  icon: ReactNode
  key: TerminalVirtualKey
}

const PRIMARY_KEY_ACTIONS: PrimaryKeyAction[] = [
  {
    icon: <ArrowLeft className="size-4" />,
    key: 'arrow-left',
    accessibleName: 'arrowLeft',
  },
  {
    icon: <ArrowDown className="size-4" />,
    key: 'arrow-down',
    accessibleName: 'arrowDown',
  },
  { icon: <ArrowUp className="size-4" />, key: 'arrow-up', accessibleName: 'arrowUp' },
  {
    icon: <ArrowRight className="size-4" />,
    key: 'arrow-right',
    accessibleName: 'arrowRight',
  },
]

const COMMAND_KEY_ICONS: Partial<Record<TerminalComposerCommandLabelKey, ReactNode>> = {
  tab: <ArrowRightToLine className="size-4" />,
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

function focusComposerInput(input: HTMLTextAreaElement): void {
  input.focus()
}

export function TerminalComposer({
  ref,
  labels,
  expanded,
  mode,
  draft,
  historyEntries,
  shortcut,
  onVirtualKey,
  onSendText,
  onOpen,
  onClose,
  onModeChange,
  onDraftChange,
  onDraftReplace,
  onResolveFiles,
  hidden,
  className,
}: TerminalComposerProps) {
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
    if (mode === 'input') {
      const input = inputRef.current
      if (!input) return
      focusComposerInput(input)
      return
    }
    modeToggleRef.current?.focus()
  }
  const requestComposerFocus = () => {
    pendingFocusRef.current = 'control'
    if (!expanded || hidden) return
    pendingFocusRef.current = null
    focusComposerControl()
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
      focusComposerInput(input)
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
    onDraftReplace(submittedDraft, '')
  }
  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeCompositionEvent(event)) return
    const editingCommand = terminalComposerEditCommandForEvent(
      event,
      isDesktopMacNavigatorPlatform(globalThis.navigator?.platform ?? ''),
    )
    if (editingCommand) {
      event.preventDefault()
      if (resolvingFiles) return
      const selectionStart = textareaOffsetToDraftOffset(draft, event.currentTarget.selectionStart)
      const selectionEnd = textareaOffsetToDraftOffset(draft, event.currentTarget.selectionEnd)
      const plan = planTerminalComposerEdit(draft, selectionStart, selectionEnd, editingCommand)
      if (plan.start === plan.end) return
      if (onDraftReplace(draft, plan.value)) {
        history.leaveBrowsing()
        pendingCaretRef.current = draftOffsetToTextareaOffset(plan.value, plan.caret)
      }
      return
    }
    if (resolvingFiles) return
    const plainVerticalNavigation = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
    if (plainVerticalNavigation && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const historicalDraft = event.key === 'ArrowUp' ? history.previous(draft) : history.next()
      if (historicalDraft !== undefined) {
        event.preventDefault()
        if (historicalDraft !== draft) {
          pendingCaretRef.current = historicalDraft.length
          onDraftChange(historicalDraft)
        }
        return
      }
    } else if (history.isBrowsing()) {
      history.leaveBrowsing()
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void submitDraft()
  }
  const closeComposer = () => {
    if (!onClose()) return
    requestTriggerFocus()
  }

  const openComposer = () => {
    let accepted = false
    flushSync(() => {
      accepted = onOpen()
    })
    if (!accepted) return
    pendingFocusRef.current = null
    const input = inputRef.current
    if (input) focusComposerInput(input)
  }
  const switchMode = (nextMode: TerminalComposerMode) => {
    let accepted = false
    flushSync(() => {
      accepted = onModeChange(nextMode)
    })
    if (!accepted) return
    if (nextMode === 'input') {
      const input = inputRef.current
      if (input) focusComposerInput(input)
      return
    }
    modeToggleRef.current?.focus()
  }
  const currentFileInsertion = () => {
    const input = inputRef.current
    return {
      start: textareaOffsetToDraftOffset(draft, input?.selectionStart ?? draft.length),
      end: textareaOffsetToDraftOffset(draft, input?.selectionEnd ?? draft.length),
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
      const start = Math.min(insertionRange.start, draft.length)
      const end = Math.min(Math.max(insertionRange.end, start), draft.length)
      const next = insertComposerText(draft, insertion, start, end)
      if (onDraftReplace(draft, next.value)) {
        pendingCaretRef.current = draftOffsetToTextareaOffset(next.value, next.caret)
      }
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
        if (
          event.target instanceof Element &&
          (event.target.closest('[data-slot="popover-content"]') ||
            event.target.closest('[data-slot="popover-trigger"][data-state="open"]'))
        ) {
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
        onClick={openComposer}
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
              switchMode(nextMode)
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
                onDraftChange(event.target.value)
              }}
              onPointerDown={() => history.leaveBrowsing()}
              onKeyDown={handleDraftKeyDown}
            />
          ) : (
            <ScrollArea
              orientation="horizontal"
              scrollbarMode="compact"
              className="goblin-terminal-composer__key-scroll"
            >
              <div className="goblin-terminal-composer__key-row">
                {TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS.map((key, index) => (
                  <ComposerButton
                    key={key.key}
                    className={`goblin-terminal-composer__key-action--optional-${index + 1}`}
                    accessibleName={labels[key.labelKey]}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onVirtualKey(key.key)}
                  >
                    {COMMAND_KEY_ICONS[key.labelKey] ?? key.keycap}
                  </ComposerButton>
                ))}
                {TERMINAL_COMPOSER_PINNED_COMMAND_KEYS.map((key) => (
                  <ComposerButton
                    key={key.key}
                    accessibleName={labels[key.labelKey]}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onVirtualKey(key.key)}
                  >
                    {COMMAND_KEY_ICONS[key.labelKey] ?? key.keycap}
                  </ComposerButton>
                ))}
                {PRIMARY_KEY_ACTIONS.map((key) => (
                  <ComposerButton
                    key={key.accessibleName}
                    accessibleName={labels[key.accessibleName]}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onVirtualKey(key.key)}
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
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
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
