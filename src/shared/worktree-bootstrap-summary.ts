export type WorktreeBootstrapMode = 'copy' | 'symlink' | 'hardlink'

export interface WorktreeBootstrapPathSummary {
  count: number
  paths: string[]
}

export interface WorktreeBootstrapSummary {
  copy: WorktreeBootstrapPathSummary
  symlink: WorktreeBootstrapPathSummary
  hardlink: WorktreeBootstrapPathSummary
  skippedMissing: WorktreeBootstrapPathSummary
  setup?: {
    command: string
  }
}

export const WORKTREE_BOOTSTRAP_SUMMARY_PATH_LIMIT = 8

export function compactWorktreeBootstrapPaths(paths: readonly string[]): WorktreeBootstrapPathSummary {
  return {
    count: paths.length,
    paths: paths.slice(0, WORKTREE_BOOTSTRAP_SUMMARY_PATH_LIMIT),
  }
}

export function hasWorktreeBootstrapSummaryDetails(summary: WorktreeBootstrapSummary | undefined): boolean {
  if (!summary) return false
  return (
    summary.copy.count > 0 ||
    summary.symlink.count > 0 ||
    summary.hardlink.count > 0 ||
    summary.skippedMissing.count > 0 ||
    !!summary.setup
  )
}

export function formatWorktreeBootstrapSummary(summary: WorktreeBootstrapSummary | undefined): string {
  if (!summary || !hasWorktreeBootstrapSummaryDetails(summary)) return ''
  return [
    formatPathSummary('Copied', summary.copy),
    formatPathSummary('Symlinked', summary.symlink),
    formatPathSummary('Hardlinked', summary.hardlink),
    formatPathSummary('Skipped missing', summary.skippedMissing),
    summary.setup ? `Ran setup: ${summary.setup.command}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatPathSummary(label: string, summary: WorktreeBootstrapPathSummary): string {
  if (summary.count === 0) return ''
  const noun = summary.count === 1 ? 'path' : 'paths'
  const suffix = summary.count > summary.paths.length ? `, and ${summary.count - summary.paths.length} more` : ''
  return `${label} ${summary.count} ${noun}: ${summary.paths.join(', ')}${suffix}`
}
