import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

export type WorkspacePaneCommandTarget =
  | {
      kind: 'git-branch'
      branchName: string
      workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null
    }
  | { kind: 'workspace-root' }

export function workspacePaneCommandCoordinates(target: WorkspacePaneCommandTarget): {
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
} {
  return target.kind === 'git-branch'
    ? { branchName: target.branchName, workspacePaneRoute: target.workspacePaneRoute }
    : { branchName: null, workspacePaneRoute: undefined }
}
