const TERMINAL_COMPOSER_HISTORY_LIMIT = 50

export class TerminalComposerHistory {
  private entries: string[] = []
  private index: number | null = null
  private draftBeforeBrowsing = ''

  record(text: string): void {
    if (!text) return
    if (this.entries.at(-1) !== text) {
      this.entries.push(text)
      if (this.entries.length > TERMINAL_COMPOSER_HISTORY_LIMIT) this.entries.shift()
    }
    this.leaveBrowsing()
  }

  previous(currentDraft: string): string | undefined {
    if (this.entries.length === 0) return undefined
    if (this.index === null) {
      if (currentDraft !== '') return undefined
      this.draftBeforeBrowsing = currentDraft
      this.index = this.entries.length - 1
    } else if (this.index > 0) {
      this.index -= 1
    }
    return this.entries[this.index]
  }

  next(): string | undefined {
    if (this.index === null) return undefined
    if (this.index < this.entries.length - 1) {
      this.index += 1
      return this.entries[this.index]
    }
    const draft = this.draftBeforeBrowsing
    this.leaveBrowsing()
    return draft
  }

  isBrowsing(): boolean {
    return this.index !== null
  }

  leaveBrowsing(): void {
    this.index = null
    this.draftBeforeBrowsing = ''
  }
}
