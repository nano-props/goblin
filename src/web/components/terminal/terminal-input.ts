export type TerminalUserInputSource = 'keyboard' | 'paste' | 'drop' | 'toolbar' | 'command' | 'xterm'
export type TerminalEmulatorInputSource = 'data'

export type TerminalInput =
  | {
      origin: 'user-intent'
      source: TerminalUserInputSource
      data: string
    }
  | {
      origin: 'terminal-emulator'
      source: TerminalEmulatorInputSource
      data: string
    }

export function userTerminalInput(data: string, source: TerminalUserInputSource): TerminalInput {
  return { origin: 'user-intent', source, data }
}

export function terminalEmulatorInput(data: string, source: TerminalEmulatorInputSource): TerminalInput {
  return { origin: 'terminal-emulator', source, data }
}

export function isTerminalEmulatorInput(input: TerminalInput): boolean {
  return input.origin === 'terminal-emulator'
}

export function isExternalCommandInput(input: TerminalInput): boolean {
  return input.origin === 'user-intent' && input.source === 'command'
}
