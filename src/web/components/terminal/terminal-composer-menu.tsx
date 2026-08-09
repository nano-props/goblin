import { defineComponent, ref } from 'vue'
import type { FunctionalComponent } from 'vue'
import { Copy, Delete, Ellipsis, Upload, X } from '@lucide/vue'
import { PopoverTrigger } from 'reka-ui'
import {
  TERMINAL_COMPOSER_COPY_ACTION,
  TERMINAL_COMPOSER_OPTIONAL_ACTIONS,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'
import type {
  TerminalComposerOptionalActionLabelKey,
  TerminalComposerOptionalVirtualKey,
} from '#/web/components/terminal/terminal-composer-command-keys.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Separator } from '#/web/components/ui/separator.tsx'

type TerminalComposerMenuLabels = Record<TerminalComposerOptionalActionLabelKey, string> & {
  more: string
  uploadFiles: string
  copyContent: string
  close: string
}

interface TerminalComposerMenuProps {
  labels: TerminalComposerMenuLabels
  mode: 'input' | 'keys'
  canUploadFiles: boolean
  resolvingFiles: boolean
  copyingContent: boolean
  onUpload: () => void
  onVirtualKey: (key: TerminalComposerOptionalVirtualKey) => void
  onCopyContent: () => void
  onClose: () => boolean
  onRestoreComposerTriggerFocus: () => void
}

type ComposerMenuCloseFocusIntent = 'popover-default' | 'preserve-existing' | 'composer-trigger'

function preventPointerFocus(event: PointerEvent): void {
  event.preventDefault()
}

function preventMouseFocus(event: MouseEvent): void {
  event.preventDefault()
}

export const TerminalComposerMenu = defineComponent<TerminalComposerMenuProps>({
  name: 'TerminalComposerMenu',
  props: [
    'labels',
    'mode',
    'canUploadFiles',
    'resolvingFiles',
    'copyingContent',
    'onUpload',
    'onVirtualKey',
    'onCopyContent',
    'onClose',
    'onRestoreComposerTriggerFocus',
  ],

  setup(props) {
    const open = ref(false)
    let closeFocusIntent: ComposerMenuCloseFocusIntent = 'popover-default'

    function closeMenu(): void {
      open.value = false
    }

    function handleMorePointerDown(event: PointerEvent): void {
      closeFocusIntent = 'preserve-existing'
      preventPointerFocus(event)
    }

    function handleCloseAutoFocus(event: Event): void {
      const intent = closeFocusIntent
      closeFocusIntent = 'popover-default'
      if (intent === 'popover-default') return
      event.preventDefault()
      if (intent === 'composer-trigger') props.onRestoreComposerTriggerFocus()
    }

    function collapseComposer(): void {
      closeFocusIntent = props.onClose() ? 'composer-trigger' : 'preserve-existing'
    }

    return () => (
      <Popover
        open={open.value}
        onOpenChange={(nextOpen) => {
          open.value = nextOpen
        }}
      >
        <PopoverTrigger asChild data-terminal-composer-menu-trigger="">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            class="goblin-terminal-composer__btn"
            onPointerdown={handleMorePointerDown}
            onMousedown={preventMouseFocus}
          >
            <span aria-hidden="true">
              <Ellipsis class="size-4" />
            </span>
            <span class="sr-only">{props.labels.more}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          class="w-max min-w-32 max-w-72 overflow-hidden p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <ScrollArea
            class="max-h-(--reka-popover-content-available-height)"
            viewportClass="p-1"
            scrollbarMode="compact"
          >
            <ComposerMenuItem disabled={props.copyingContent} onClick={props.onCopyContent} closeMenu={closeMenu}>
              <span aria-hidden="true" class="inline-flex w-6 shrink-0 items-center justify-center">
                <Copy class="size-4" />
              </span>
              {props.labels[TERMINAL_COMPOSER_COPY_ACTION.labelKey]}
            </ComposerMenuItem>
            {props.mode === 'keys' || props.canUploadFiles ? <Separator class="-mx-1 my-1 w-auto" /> : null}
            {props.mode === 'input' && props.canUploadFiles ? (
              <ComposerMenuItem disabled={props.resolvingFiles} onClick={props.onUpload} closeMenu={closeMenu}>
                <Upload class="size-4" />
                {props.labels.uploadFiles}
              </ComposerMenuItem>
            ) : null}
            {props.mode === 'keys'
              ? TERMINAL_COMPOSER_OPTIONAL_ACTIONS.map((action) => (
                  <ComposerMenuItem
                    key={action.key}
                    onClick={() => props.onVirtualKey(action.key)}
                    closeMenu={closeMenu}
                  >
                    {action.key === 'backspace' ? (
                      <span aria-hidden="true" class="inline-flex w-6 shrink-0 items-center justify-center">
                        <Delete class="size-4" />
                      </span>
                    ) : (
                      <Keycap>{action.keycap}</Keycap>
                    )}
                    {props.labels[action.labelKey]}
                  </ComposerMenuItem>
                ))
              : null}
            <Separator class="-mx-1 my-1 w-auto" />
            <ComposerMenuItem onClick={collapseComposer} closeMenu={closeMenu}>
              <X class="size-4" />
              {props.labels.close}
            </ComposerMenuItem>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    )
  },
})

interface ComposerMenuItemProps {
  closeMenu: () => void
  disabled?: boolean
  onClick: (event: MouseEvent) => void
}

const ComposerMenuItem: FunctionalComponent<ComposerMenuItemProps> = (props, { slots }) => {
  function handleClick(event: MouseEvent): void {
    event.stopPropagation()
    props.closeMenu()
    props.onClick(event)
  }

  return (
    <button
      type="button"
      disabled={props.disabled}
      onPointerdown={preventPointerFocus}
      onMousedown={preventMouseFocus}
      onClick={handleClick}
      class="group relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      {slots.default?.()}
    </button>
  )
}
ComposerMenuItem.props = ['closeMenu', 'disabled', 'onClick']

const Keycap: FunctionalComponent = (_props, { slots }) => (
  <kbd
    data-terminal-composer-keycap=""
    aria-hidden="true"
    class="inline-flex h-[18px] w-6 shrink-0 items-center justify-center rounded-[4px] border border-border bg-muted/40 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-xs"
  >
    {slots.default?.()}
  </kbd>
)
