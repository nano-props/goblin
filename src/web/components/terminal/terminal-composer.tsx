import '#/web/components/terminal/terminal-composer.css'
import { defineComponent, nextTick, onMounted, onScopeDispose, ref, useId, watch } from 'vue'
import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes, VNodeChild } from 'vue'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  CornerDownLeft,
  Copy,
  Delete,
  Keyboard,
  TextCursorInput,
} from '@lucide/vue'
import {
  TERMINAL_COMPOSER_COPY_ACTION,
  TERMINAL_COMPOSER_OPTIONAL_ACTIONS,
  TERMINAL_COMPOSER_PINNED_COMMAND_KEYS,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'
import type { TerminalComposerActionLabelKey } from '#/web/components/terminal/terminal-composer-command-keys.ts'
import {
  draftOffsetToTextareaOffset,
  planTerminalComposerEdit,
  textareaOffsetToDraftOffset,
  terminalComposerEditCommandForEvent,
} from '#/web/components/terminal/terminal-composer-editing.ts'
import { TerminalComposerHistoryCursor } from '#/web/components/terminal/terminal-composer-history-cursor.ts'
import { isDesktopMacNavigatorPlatform, isImeOwnedKeyboardEvent } from '#/web/components/terminal/terminal-keyboard.ts'
import { TerminalComposerMenu } from '#/web/components/terminal/terminal-composer-menu.tsx'
import type { TerminalComposerMode, TerminalVirtualKey } from '#/web/components/terminal/types.ts'
import { Button } from '#/web/components/ui/button.tsx'
import type { ElementRef } from '#/web/components/ui/refs.ts'
import { toButtonVNodeRef } from '#/web/components/ui/refs.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'

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
  ctrlL: string
  ctrlC: string
  ctrlD: string
  copyContent: string
}

interface TerminalComposerProps {
  labels: TerminalComposerLabels
  expanded: boolean
  mode: TerminalComposerMode
  draft: string
  historyEntries: readonly string[]
  shortcut: string
  canUploadFiles: boolean
  onVirtualKey: (key: TerminalVirtualKey) => void
  onCopyContent: () => Promise<void>
  onSendText: (text: string) => Promise<boolean>
  onOpen: () => boolean
  onClose: () => boolean
  onModeChange: (mode: TerminalComposerMode) => boolean
  onDraftChange: (draft: string) => boolean
  onDraftReplace: (expectedDraft: string, draft: string) => boolean
  onResolveFiles: (files: File[]) => Promise<string | null>
  onFileInsertionRejected: () => void
  hidden?: boolean
  class?: HTMLAttributes['class']
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
  icon: VNodeChild
  key: TerminalVirtualKey
}

const PRIMARY_KEY_ACTIONS: PrimaryKeyAction[] = [
  { icon: <ArrowLeft class="size-4" />, key: 'arrow-left', accessibleName: 'arrowLeft' },
  { icon: <ArrowDown class="size-4" />, key: 'arrow-down', accessibleName: 'arrowDown' },
  { icon: <ArrowUp class="size-4" />, key: 'arrow-up', accessibleName: 'arrowUp' },
  { icon: <ArrowRight class="size-4" />, key: 'arrow-right', accessibleName: 'arrowRight' },
]

const COMMAND_KEY_ICONS: Partial<Record<TerminalComposerActionLabelKey, VNodeChild>> = {
  tab: <ArrowRightToLine class="size-4" />,
  enter: <CornerDownLeft class="size-4" />,
  backspace: <Delete class="size-4" />,
}

const COMPOSER_INPUT_MIN_HEIGHT_PX = 40
const COMPOSER_INPUT_MAX_HEIGHT_PX = 160

function resizeComposerInput(input: HTMLTextAreaElement, hasContent: boolean): void {
  input.style.height = `${COMPOSER_INPUT_MIN_HEIGHT_PX}px`
  if (!hasContent) return
  input.style.height = `${Math.min(
    COMPOSER_INPUT_MAX_HEIGHT_PX,
    Math.max(COMPOSER_INPUT_MIN_HEIGHT_PX, input.scrollHeight),
  )}px`
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

function isImeCompositionEvent(event: KeyboardEvent): boolean {
  return isImeOwnedKeyboardEvent(event)
}

function focusComposerInput(input: HTMLTextAreaElement): void {
  input.focus()
}

export const TerminalComposer = defineComponent<TerminalComposerProps>({
  name: 'TerminalComposer',
  props: [
    'labels',
    'expanded',
    'mode',
    'draft',
    'historyEntries',
    'shortcut',
    'canUploadFiles',
    'onVirtualKey',
    'onCopyContent',
    'onSendText',
    'onOpen',
    'onClose',
    'onModeChange',
    'onDraftChange',
    'onDraftReplace',
    'onResolveFiles',
    'onFileInsertionRejected',
    'hidden',
    'class',
  ],

  setup(props, { expose }) {
    const resolvingFiles = ref(false)
    const copyingContent = ref(false)
    const trigger = ref<HTMLButtonElement | null>(null)
    const root = ref<HTMLDivElement | null>(null)
    const modeToggle = ref<HTMLButtonElement | null>(null)
    const fileInput = ref<HTMLInputElement | null>(null)
    const input = ref<HTMLTextAreaElement | null>(null)
    const history = new TerminalComposerHistoryCursor()
    const composerId = useId()
    let fileInsertion = { start: 0, end: 0 }
    let pendingCaret: number | null = null
    let pendingFocus: 'control' | 'trigger' | null = null

    function focusComposerControl(): void {
      if (props.mode === 'input') {
        if (input.value) focusComposerInput(input.value)
        return
      }
      modeToggle.value?.focus()
    }

    function requestComposerFocus(): void {
      pendingFocus = 'control'
      if (!props.expanded || props.hidden) return
      pendingFocus = null
      focusComposerControl()
    }

    function requestTriggerFocus(): void {
      pendingFocus = 'trigger'
      if (props.expanded) return
      pendingFocus = null
      trigger.value?.focus()
    }

    expose<TerminalComposerHandle>({ focus: requestComposerFocus })

    watch(
      () => props.historyEntries,
      (entries) => history.updateEntries(entries),
      { immediate: true },
    )

    // Draft, mode, and visibility changes alter the mounted control. This
    // post-render synchronization applies the pending caret/focus exactly once.
    watch(
      [() => props.draft, () => props.expanded, () => props.mode, () => props.hidden, input],
      () => {
        const textarea = input.value
        if (textarea && props.expanded && props.mode === 'input') {
          resizeComposerInput(textarea, props.draft.length > 0)
          if (pendingCaret !== null) {
            const caret = pendingCaret
            pendingCaret = null
            focusComposerInput(textarea)
            textarea.setSelectionRange(caret, caret)
          }
        }
        if (props.hidden) {
          pendingFocus = null
          return
        }
        if (pendingFocus === 'control' && props.expanded) {
          pendingFocus = null
          focusComposerControl()
        } else if (pendingFocus === 'trigger' && !props.expanded) {
          pendingFocus = null
          trigger.value?.focus()
        }
      },
      { flush: 'post' },
    )

    // The observer belongs to the currently mounted input-mode textarea.
    watch(
      [() => props.expanded, () => props.mode, input],
      (_state, _previous, onCleanup) => {
        const textarea = input.value
        if (!textarea || !props.expanded || props.mode !== 'input' || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => resizeComposerInput(textarea, textarea.value.length > 0))
        observer.observe(textarea)
        onCleanup(() => observer.disconnect())
      },
      { flush: 'post' },
    )

    async function submitDraft(): Promise<void> {
      const submittedDraft = props.draft
      if (!submittedDraft || resolvingFiles.value) return
      const onSendText = props.onSendText
      const onDraftReplace = props.onDraftReplace
      if (!(await onSendText(submittedDraft))) return
      history.leaveBrowsing()
      onDraftReplace(submittedDraft, '')
    }

    function handleDraftKeyDown(event: KeyboardEvent): void {
      if (!(event.currentTarget instanceof HTMLTextAreaElement) || isImeCompositionEvent(event)) return
      const editingCommand = terminalComposerEditCommandForEvent(
        event,
        isDesktopMacNavigatorPlatform(globalThis.navigator?.platform ?? ''),
      )
      const draft = props.draft
      if (editingCommand) {
        event.preventDefault()
        if (resolvingFiles.value) return
        const selectionStart = textareaOffsetToDraftOffset(draft, event.currentTarget.selectionStart)
        const selectionEnd = textareaOffsetToDraftOffset(draft, event.currentTarget.selectionEnd)
        const plan = planTerminalComposerEdit(draft, selectionStart, selectionEnd, editingCommand)
        if (plan.start === plan.end) return
        if (props.onDraftReplace(draft, plan.value)) {
          history.leaveBrowsing()
          pendingCaret = draftOffsetToTextareaOffset(plan.value, plan.caret)
        }
        return
      }
      if (resolvingFiles.value) return
      const plainVerticalNavigation = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      if (plainVerticalNavigation && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const historicalDraft = event.key === 'ArrowUp' ? history.previous(draft) : history.next()
        if (historicalDraft !== undefined) {
          event.preventDefault()
          if (historicalDraft !== draft) {
            pendingCaret = historicalDraft.length
            props.onDraftChange(historicalDraft)
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

    function closeComposer(): boolean {
      if (!props.onClose()) return false
      requestTriggerFocus()
      return true
    }

    function openComposer(): void {
      if (!props.onOpen()) return
      pendingFocus = 'control'
      void nextTick(() => {
        if (pendingFocus === 'control' && props.expanded && !props.hidden) {
          pendingFocus = null
          focusComposerControl()
        }
      })
    }

    function switchMode(nextMode: TerminalComposerMode): void {
      if (!props.onModeChange(nextMode)) return
      pendingFocus = 'control'
      void nextTick(() => {
        if (pendingFocus === 'control' && props.expanded && !props.hidden) {
          pendingFocus = null
          focusComposerControl()
        }
      })
    }

    function currentFileInsertion(): { start: number; end: number } {
      const textarea = input.value
      return {
        start: textareaOffsetToDraftOffset(props.draft, textarea?.selectionStart ?? props.draft.length),
        end: textareaOffsetToDraftOffset(props.draft, textarea?.selectionEnd ?? props.draft.length),
      }
    }

    function openFilePicker(): void {
      fileInsertion = currentFileInsertion()
      fileInput.value?.click()
    }

    async function resolveFilesIntoDraft(files: File[], insertionRange: { start: number; end: number }): Promise<void> {
      if (files.length === 0 || resolvingFiles.value) return
      const expectedDraft = props.draft
      const onResolveFiles = props.onResolveFiles
      const onDraftReplace = props.onDraftReplace
      const onFileInsertionRejected = props.onFileInsertionRejected
      resolvingFiles.value = true
      try {
        const insertion = await onResolveFiles(files)
        if (!insertion) return
        history.leaveBrowsing()
        const start = Math.min(insertionRange.start, expectedDraft.length)
        const end = Math.min(Math.max(insertionRange.end, start), expectedDraft.length)
        const nextDraft = insertComposerText(expectedDraft, insertion, start, end)
        if (!onDraftReplace(expectedDraft, nextDraft.value)) {
          onFileInsertionRejected()
          return
        }
        pendingCaret = draftOffsetToTextareaOffset(nextDraft.value, nextDraft.caret)
      } finally {
        resolvingFiles.value = false
      }
    }

    async function handleFileSelection(event: Event): Promise<void> {
      if (!(event.currentTarget instanceof HTMLInputElement)) return
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      await resolveFilesIntoDraft(files, fileInsertion)
    }

    async function copyContent(): Promise<void> {
      if (copyingContent.value) return
      copyingContent.value = true
      try {
        await props.onCopyContent()
      } finally {
        copyingContent.value = false
      }
    }

    function handleComposerKeyDown(event: KeyboardEvent): void {
      if (!props.expanded || event.key !== 'Escape' || isImeCompositionEvent(event)) return
      if (
        event.target instanceof Element &&
        (event.target.closest('[data-slot="popover-content"]') ||
          event.target.closest('[data-terminal-composer-menu-trigger][data-state="open"]'))
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      closeComposer()
    }

    onMounted(() => root.value?.addEventListener('keydown', handleComposerKeyDown, true))
    onScopeDispose(() => root.value?.removeEventListener('keydown', handleComposerKeyDown, true))

    return () => (
      <div
        ref={root}
        class={cn('goblin-terminal-composer', props.expanded && 'goblin-terminal-composer--expanded', props.class)}
        data-expanded={props.expanded}
        hidden={props.hidden}
        role="group"
        aria-label={props.labels.composer}
      >
        <ComposerButton
          buttonRef={trigger}
          class="goblin-terminal-composer__toggle"
          accessibleName={props.labels.open}
          aria-expanded={props.expanded}
          aria-controls={composerId}
          aria-hidden={props.expanded}
          aria-keyshortcuts={props.shortcut}
          tabindex={props.expanded ? -1 : undefined}
          onClick={openComposer}
        >
          <Keyboard class="size-5" />
        </ComposerButton>
        <div
          id={composerId}
          class="goblin-terminal-composer__surface"
          aria-hidden={!props.expanded}
          inert={!props.expanded ? true : undefined}
        >
          <div class="goblin-terminal-composer__mode-row">
            <ComposerButton
              buttonRef={modeToggle}
              accessibleName={props.mode === 'input' ? props.labels.showKeys : props.labels.showInput}
              onClick={() => switchMode(props.mode === 'input' ? 'keys' : 'input')}
            >
              {props.mode === 'input' ? <Keyboard class="size-4" /> : <TextCursorInput class="size-4" />}
            </ComposerButton>
            {props.mode === 'input' ? (
              <textarea
                ref={input}
                rows={1}
                value={props.draft}
                readonly={resolvingFiles.value}
                aria-busy={resolvingFiles.value || undefined}
                aria-label={props.labels.inputPlaceholder}
                placeholder={props.labels.inputPlaceholder}
                autocapitalize="off"
                autocorrect="off"
                spellcheck={false}
                enterkeyhint="send"
                class="goblin-terminal-composer__input font-mono"
                onInput={(event) => {
                  if (!(event.currentTarget instanceof HTMLTextAreaElement)) return
                  history.leaveBrowsing()
                  props.onDraftChange(event.currentTarget.value)
                }}
                onPointerdown={() => history.leaveBrowsing()}
                onKeydown={handleDraftKeyDown}
              />
            ) : (
              <ScrollArea orientation="horizontal" scrollbarMode="compact" class="goblin-terminal-composer__key-scroll">
                <div class="goblin-terminal-composer__key-row">
                  <ComposerButton
                    class="goblin-terminal-composer__key-action--optional-6"
                    accessibleName={props.labels[TERMINAL_COMPOSER_COPY_ACTION.labelKey]}
                    disabled={copyingContent.value}
                    aria-busy={copyingContent.value || undefined}
                    onPointerdown={(event) => event.preventDefault()}
                    onClick={() => void copyContent()}
                  >
                    <Copy class="size-4" />
                  </ComposerButton>
                  {TERMINAL_COMPOSER_OPTIONAL_ACTIONS.map((action, index) => (
                    <ComposerButton
                      key={action.key}
                      class={`goblin-terminal-composer__key-action--optional-${index + 1}`}
                      accessibleName={props.labels[action.labelKey]}
                      onPointerdown={(event) => event.preventDefault()}
                      onClick={() => props.onVirtualKey(action.key)}
                    >
                      {COMMAND_KEY_ICONS[action.labelKey] ?? action.keycap}
                    </ComposerButton>
                  ))}
                  {TERMINAL_COMPOSER_PINNED_COMMAND_KEYS.map((key) => (
                    <ComposerButton
                      key={key.key}
                      accessibleName={props.labels[key.labelKey]}
                      onPointerdown={(event) => event.preventDefault()}
                      onClick={() => props.onVirtualKey(key.key)}
                    >
                      {COMMAND_KEY_ICONS[key.labelKey] ?? key.keycap}
                    </ComposerButton>
                  ))}
                  {PRIMARY_KEY_ACTIONS.map((key) => (
                    <ComposerButton
                      key={key.accessibleName}
                      accessibleName={props.labels[key.accessibleName]}
                      onPointerdown={(event) => event.preventDefault()}
                      onClick={() => props.onVirtualKey(key.key)}
                    >
                      {key.icon}
                    </ComposerButton>
                  ))}
                </div>
              </ScrollArea>
            )}
            {props.canUploadFiles ? (
              <input
                ref={fileInput}
                hidden
                tabindex={-1}
                aria-hidden="true"
                type="file"
                multiple
                onChange={(event) => void handleFileSelection(event)}
              />
            ) : null}
            <TerminalComposerMenu
              labels={props.labels}
              mode={props.mode}
              canUploadFiles={props.canUploadFiles}
              resolvingFiles={resolvingFiles.value}
              copyingContent={copyingContent.value}
              onUpload={openFilePicker}
              onVirtualKey={props.onVirtualKey}
              onCopyContent={() => void copyContent()}
              onClose={closeComposer}
              onRestoreComposerTriggerFocus={requestTriggerFocus}
            />
          </div>
        </div>
      </div>
    )
  },
})

interface ComposerButtonProps extends ButtonHTMLAttributes {
  accessibleName: string
  buttonRef?: ElementRef<HTMLButtonElement>
  onClick: (event: MouseEvent) => void
}

const ComposerButton: FunctionalComponent<ComposerButtonProps> = (props, { attrs, slots }) => {
  const { class: classValue, ...buttonAttrs } = attrs as ButtonHTMLAttributes
  return (
    <Button
      {...buttonAttrs}
      ref={toButtonVNodeRef(props.buttonRef)}
      type="button"
      size="icon"
      variant="secondary"
      onClick={props.onClick}
      class={cn('goblin-terminal-composer__btn', classValue)}
    >
      <span aria-hidden="true">{slots.default?.()}</span>
      <span class="sr-only">{props.accessibleName}</span>
    </Button>
  )
}
ComposerButton.props = ['accessibleName', 'buttonRef', 'onClick']
ComposerButton.inheritAttrs = false
