export interface TerminalDirectoryEntry<TUser extends string | number> {
  id: string
  userId: TUser
  scope: string
  terminalSessionId: string
}

export interface TerminalDirectoryReservation<TUser extends string | number> {
  id: string
  userId: TUser
  scope: string
  terminalSessionId: string
}

export class TerminalDirectory<
  TUser extends string | number,
  TEntry extends TerminalDirectoryEntry<TUser>,
> {
  private readonly entriesByRuntimeId = new Map<string, TEntry>()
  private readonly runtimeIdByUserSession = new Map<string, string>()
  private readonly reservationsByRuntimeId = new Map<string, TerminalDirectoryReservation<TUser>>()
  private readonly reservedRuntimeIdByUserSession = new Map<string, string>()
  private readonly catalogRevisionByScope = new Map<string, number>()

  private publish(entry: TEntry): void {
    if (this.entriesByRuntimeId.has(entry.id)) throw new Error('terminal directory runtime identity conflict')
    const durableKey = this.userSessionKey(entry.userId, entry.terminalSessionId)
    if (this.runtimeIdByUserSession.has(durableKey)) throw new Error('terminal directory durable identity conflict')
    this.entriesByRuntimeId.set(entry.id, entry)
    this.runtimeIdByUserSession.set(durableKey, entry.id)
    this.advanceCatalogRevision(entry.userId, entry.scope)
  }

  reserve(identity: TerminalDirectoryReservation<TUser>): {
    commit: (entry: TEntry) => void
    abort: () => void
  } | null {
    const durableKey = this.userSessionKey(identity.userId, identity.terminalSessionId)
    if (this.hasIdentityConflict(identity, durableKey)) return null
    this.reservationsByRuntimeId.set(identity.id, identity)
    this.reservedRuntimeIdByUserSession.set(durableKey, identity.id)
    let settled = false
    return {
      commit: (entry) => {
        if (settled) throw new Error('terminal directory reservation already settled')
        if (this.reservationsByRuntimeId.get(identity.id) !== identity)
          throw new Error('terminal directory reservation ownership lost')
        if (!reservationMatchesEntry(identity, entry)) throw new Error('terminal directory reservation identity mismatch')
        this.publish(entry)
        settled = true
        this.reservationsByRuntimeId.delete(identity.id)
        this.reservedRuntimeIdByUserSession.delete(durableKey)
      },
      abort: () => {
        if (settled) return
        settled = true
        if (this.reservationsByRuntimeId.get(identity.id) === identity) this.reservationsByRuntimeId.delete(identity.id)
        if (this.reservedRuntimeIdByUserSession.get(durableKey) === identity.id)
          this.reservedRuntimeIdByUserSession.delete(durableKey)
      },
    }
  }

  private hasIdentityConflict(identity: TerminalDirectoryReservation<TUser>, durableKey: string): boolean {
    return (
      this.entriesByRuntimeId.has(identity.id) ||
      this.reservationsByRuntimeId.has(identity.id) ||
      this.runtimeIdByUserSession.has(durableKey) ||
      this.reservedRuntimeIdByUserSession.has(durableKey)
    )
  }

  get(runtimeId: string): TEntry | undefined {
    return this.entriesByRuntimeId.get(runtimeId)
  }

  getByDurableId(userId: TUser, terminalSessionId: string): TEntry | undefined {
    const runtimeId = this.runtimeIdByUserSession.get(this.userSessionKey(userId, terminalSessionId))
    return runtimeId ? this.entriesByRuntimeId.get(runtimeId) : undefined
  }

  remove(entry: TEntry): boolean {
    if (this.entriesByRuntimeId.get(entry.id) !== entry) return false
    this.entriesByRuntimeId.delete(entry.id)
    const durableKey = this.userSessionKey(entry.userId, entry.terminalSessionId)
    if (this.runtimeIdByUserSession.get(durableKey) === entry.id) this.runtimeIdByUserSession.delete(durableKey)
    this.advanceCatalogRevision(entry.userId, entry.scope)
    return true
  }

  change(entry: TEntry, mutate: () => void): number {
    if (this.entriesByRuntimeId.get(entry.id) !== entry) throw new Error('terminal directory entry unavailable')
    mutate()
    this.advanceCatalogRevision(entry.userId, entry.scope)
    return this.catalogRevision(entry.userId, entry.scope)
  }

  entries(): IterableIterator<TEntry> {
    return this.entriesByRuntimeId.values()
  }

  entriesForScope(userId: TUser, scope: string): TEntry[] {
    return Array.from(this.entriesByRuntimeId.values()).filter(
      (entry) => entry.userId === userId && entry.scope === scope,
    )
  }

  catalogRevision(userId: TUser, scope: string): number {
    return this.catalogRevisionByScope.get(this.scopeKey(userId, scope)) ?? 0
  }

  releaseScope(userId: TUser, scope: string): void {
    if (this.entriesForScope(userId, scope).length > 0) {
      throw new Error('cannot release terminal catalog revision with live sessions')
    }
    this.catalogRevisionByScope.delete(this.scopeKey(userId, scope))
  }

  private advanceCatalogRevision(userId: TUser, scope: string): void {
    const key = this.scopeKey(userId, scope)
    this.catalogRevisionByScope.set(key, (this.catalogRevisionByScope.get(key) ?? 0) + 1)
  }

  private userSessionKey(userId: TUser, terminalSessionId: string): string {
    return `${String(userId)}\0${terminalSessionId}`
  }

  private scopeKey(userId: TUser, scope: string): string {
    return `${String(userId)}\0${scope}`
  }
}

function reservationMatchesEntry<TUser extends string | number>(
  identity: TerminalDirectoryReservation<TUser>,
  entry: TerminalDirectoryEntry<TUser>,
): boolean {
  return (
    entry.id === identity.id &&
    entry.userId === identity.userId &&
    entry.scope === identity.scope &&
    entry.terminalSessionId === identity.terminalSessionId
  )
}
