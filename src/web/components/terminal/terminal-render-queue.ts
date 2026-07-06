import type { Terminal as XTermTerminal } from '@xterm/xterm'
import type { TerminalOutputCheckpoint } from '#/web/components/terminal/terminal-session-state.ts'
import { terminalLog } from '#/web/logger.ts'

export interface RenderedOutputCheckpoint extends TerminalOutputCheckpoint {
  terminalRuntimeSessionId: string
}

type TerminalRenderQueueEntry =
  | {
      kind: 'replace'
      term: XTermTerminal
      data: string
      checkpoint: RenderedOutputCheckpoint
      resolve: (applied: boolean) => void
      reject: (err: unknown) => void
    }
  | {
      kind: 'append'
      term: XTermTerminal
      data: string
      checkpoint: RenderedOutputCheckpoint
    }

interface TerminalRenderQueueOptions {
  isCurrentTerm: (term: XTermTerminal) => boolean
  isCheckpointRendered: (checkpoint: RenderedOutputCheckpoint) => boolean
  markOutputRendered: (checkpoint: RenderedOutputCheckpoint) => void
}

export class TerminalRenderQueue {
  private running = false
  private entries: TerminalRenderQueueEntry[] = []
  private readonly options: TerminalRenderQueueOptions
  private generation = 0

  constructor(options: TerminalRenderQueueOptions) {
    this.options = options
  }

  replace(term: XTermTerminal, data: string, checkpoint: RenderedOutputCheckpoint): Promise<boolean> {
    this.generation += 1
    this.clear()
    return new Promise<boolean>((resolve, reject) => {
      this.entries.push({ kind: 'replace', term, data, checkpoint, resolve, reject })
      this.pump()
    })
  }

  append(term: XTermTerminal, data: string, checkpoint: RenderedOutputCheckpoint): void {
    if (!data) return
    this.entries.push({ kind: 'append', term, data, checkpoint })
    this.pump()
  }

  clear(): void {
    this.generation += 1
    const queued = this.entries.splice(0)
    for (const entry of queued) {
      if (entry.kind === 'replace') entry.resolve(false)
    }
  }

  private pump(): void {
    if (this.running) return
    const entry = this.entries.shift()
    if (!entry) return
    this.running = true
    const generation = this.generation
    void this.run(entry, generation)
      .then((applied) => {
        if (entry.kind === 'replace') entry.resolve(applied)
      })
      .catch((err) => {
        if (entry.kind === 'replace') entry.reject(err)
        else terminalLog.warn('failed to append terminal output', { err })
      })
      .finally(() => {
        this.running = false
        this.pump()
      })
  }

  private async run(entry: TerminalRenderQueueEntry, generation: number): Promise<boolean> {
    if (!this.options.isCurrentTerm(entry.term)) return false
    if (entry.kind === 'replace') {
      entry.term.reset()
      if (entry.data) await termWrite(entry.term, entry.data)
      if (this.isCurrentEntry(entry.term, generation)) this.options.markOutputRendered(entry.checkpoint)
      return this.isCurrentEntry(entry.term, generation)
    }
    if (this.options.isCheckpointRendered(entry.checkpoint)) return true
    await termWrite(entry.term, entry.data)
    if (this.isCurrentEntry(entry.term, generation)) this.options.markOutputRendered(entry.checkpoint)
    return this.isCurrentEntry(entry.term, generation)
  }

  private isCurrentEntry(term: XTermTerminal, generation: number): boolean {
    return this.generation === generation && this.options.isCurrentTerm(term)
  }
}

function termWrite(term: XTermTerminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, resolve)
  })
}
