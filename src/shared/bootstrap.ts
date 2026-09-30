export interface InitialServerSnapshot {
  url: string
  /** Optional token from a QR/login handoff; ordinary sessions use an HttpOnly auth cookie. */
  accessToken?: string
}

/** Optional server handoff read once before browser startup. Settings hydrate through server procedures. */
export interface ClientBootstrapSnapshot {
  initialServer: InitialServerSnapshot | null
}
