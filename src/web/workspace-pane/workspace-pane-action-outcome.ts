export type WorkspacePaneActionOutcome =
  | { kind: 'completed'; changed: boolean; presentation: 'router-settled' | 'observed' | 'superseded' }
  | { kind: 'already-current' }
  | { kind: 'unsupported'; reason: 'worktree-required' }
  | { kind: 'superseded' }
  | { kind: 'target-missing' }
  | { kind: 'blocked' }
  | { kind: 'mutation-failed' }
  | { kind: 'navigation-rejected' }

export function workspacePaneActionOutcomeSucceeded(outcome: WorkspacePaneActionOutcome): boolean {
  return outcome.kind === 'completed' || outcome.kind === 'already-current'
}

export function workspacePaneActionOutcomeHandled(outcome: WorkspacePaneActionOutcome): boolean {
  return outcome.kind !== 'unsupported' && outcome.kind !== 'target-missing'
}
