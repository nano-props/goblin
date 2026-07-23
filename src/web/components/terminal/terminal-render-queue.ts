import type { Terminal as XTermTerminal } from '@xterm/xterm'
import type { TerminalOutputCheckpoint } from '#/web/components/terminal/terminal-session-state.ts'
import { terminalLog } from '#/web/logger.ts'

export interface RenderedOutputCheckpoint extends TerminalOutputCheckpoint {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
}

type TerminalRenderQueueEntry =
  | {
      kind: 'replace'
      data: string
      checkpoint: RenderedOutputCheckpoint
      resolve: (applied: boolean) => void
      reject: (error: unknown) => void
      settled: boolean
      revision: number
    }
  | {
      kind: 'append'
      data: string
      checkpoint: RenderedOutputCheckpoint
      resolve: (applied: boolean) => void
      settled: boolean
      revision: number
    }

interface TerminalRenderQueueOptions {
  isCurrent: () => boolean
  isCheckpointRendered: (checkpoint: RenderedOutputCheckpoint) => boolean
  markOutputRendered: (checkpoint: RenderedOutputCheckpoint) => void
}

export class TerminalRenderQueue {
  private readonly term: XTermTerminal
  private active: TerminalRenderQueueEntry | null = null
  private entries: TerminalRenderQueueEntry[] = []
  private readonly options: TerminalRenderQueueOptions
  private revision = 0

  constructor(term: XTermTerminal, options: TerminalRenderQueueOptions) {
    this.term = term
    this.options = options
  }

  replace(data: string, checkpoint: RenderedOutputCheckpoint): Promise<boolean> {
    this.clear()
    return new Promise<boolean>((resolve, reject) => {
      this.entries.push({
        kind: 'replace',
        data,
        checkpoint,
        resolve,
        reject,
        settled: false,
        revision: this.revision,
      })
      this.pump()
    })
  }

  append(data: string, checkpoint: RenderedOutputCheckpoint): Promise<boolean> {
    if (!data) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      this.entries.push({
        kind: 'append',
        data,
        checkpoint,
        resolve,
        settled: false,
        revision: this.revision,
      })
      this.pump()
    })
  }

  clear(): void {
    this.revision += 1
    for (const entry of this.entries.splice(0)) this.settle(entry, false)
    if (this.active) this.settle(this.active, false)
  }

  private pump(): void {
    if (this.active) return
    const entry = this.entries.shift()
    if (!entry) return
    this.active = entry
    void this.run(entry)
      .then((applied) => this.settle(entry, applied))
      .catch((error) => {
        if (entry.kind === 'replace') this.reject(entry, error)
        else {
          terminalLog.warn('failed to append terminal output', { error })
          this.settle(entry, false)
        }
      })
      .finally(() => {
        if (this.active === entry) this.active = null
        this.pump()
      })
  }

  private async run(entry: TerminalRenderQueueEntry): Promise<boolean> {
    if (!this.isCurrent(entry)) return false
    if (entry.kind === 'replace') {
      this.term.reset()
      if (entry.data) await termWrite(this.term, entry.data)
    } else {
      if (this.options.isCheckpointRendered(entry.checkpoint)) return true
      await termWrite(this.term, entry.data)
    }
    if (this.isCurrent(entry)) this.options.markOutputRendered(entry.checkpoint)
    return this.isCurrent(entry)
  }

  private isCurrent(entry: TerminalRenderQueueEntry): boolean {
    return this.revision === entry.revision && this.options.isCurrent()
  }

  private settle(entry: TerminalRenderQueueEntry, applied: boolean): void {
    if (entry.settled) return
    entry.settled = true
    entry.resolve(applied)
  }

  private reject(entry: Extract<TerminalRenderQueueEntry, { kind: 'replace' }>, error: unknown): void {
    if (entry.settled) return
    entry.settled = true
    entry.reject(error)
  }
}

function termWrite(term: XTermTerminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, resolve)
  })
}
