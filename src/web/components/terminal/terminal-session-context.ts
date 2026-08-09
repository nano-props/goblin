import { defineComponent, inject, provide } from 'vue'
import type { InjectionKey, PropType } from 'vue'
import { createInitialTerminalComposerState } from '#/web/components/terminal/terminal-composer-state.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSnapshot,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'

const terminalSessionContextKey: InjectionKey<TerminalSessionContextValue> = Symbol('terminal-session-command')
const terminalSessionReadContextKey: InjectionKey<TerminalSessionReadContextValue> = Symbol('terminal-session-read')

export const EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT: TerminalFilesystemTargetSnapshot = {
  terminalFilesystemTargetKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  outputActiveCount: 0,
  createPending: false,
}

export const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  composer: createInitialTerminalComposerState(),
}

export function provideTerminalSessionContext(value: TerminalSessionContextValue): void {
  provide(terminalSessionContextKey, value)
}

export function provideTerminalSessionReadContext(value: TerminalSessionReadContextValue): void {
  provide(terminalSessionReadContextKey, value)
}

export const TerminalSessionCommandScope = defineComponent(
  (props: { value: TerminalSessionContextValue }, { slots }) => {
    provideTerminalSessionContext(props.value)
    return () => slots.default?.()
  },
  {
    name: 'TerminalSessionCommandScope',
    props: {
      value: { type: Object as PropType<TerminalSessionContextValue>, required: true },
    },
  },
)

export const TerminalSessionReadScope = defineComponent(
  (props: { value: TerminalSessionReadContextValue }, { slots }) => {
    provideTerminalSessionReadContext(props.value)
    return () => slots.default?.()
  },
  {
    name: 'TerminalSessionReadScope',
    props: {
      value: { type: Object as PropType<TerminalSessionReadContextValue>, required: true },
    },
  },
)

export function useTerminalSessionContext(): TerminalSessionContextValue {
  const value = inject(terminalSessionContextKey, null)
  if (!value) throw new Error('Terminal session context is unavailable')
  return value
}

export function useTerminalSessionReadContext(): TerminalSessionReadContextValue {
  const value = inject(terminalSessionReadContextKey, null)
  if (!value) throw new Error('Terminal session read context is unavailable')
  return value
}
