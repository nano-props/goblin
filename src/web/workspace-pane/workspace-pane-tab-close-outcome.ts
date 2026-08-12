export type WorkspacePaneTabCloseOutcome =
  | { kind: 'not-committed'; message: string | null }
  | { kind: 'committed'; projection: 'applied' | 'superseded' | 'failed' }
