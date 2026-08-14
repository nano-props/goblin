export class TerminalComposerHistoryCursor {
  private entries: readonly string[] = []
  private index: number | null = null
  private draftBeforeBrowsing = ''

  updateEntries(entries: readonly string[]): void {
    if (this.entries === entries) return
    this.entries = entries
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
