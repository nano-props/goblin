# Filetree

Worktree-scoped, read-only file tree. A self-contained vertical slice parallel to `repos`, `settings`, `terminal`, `remote` (`docs/layering.md`).

## Model

- **Root**: absolute path of the current worktree. Identified by the worktree, not the checked-out branch.
- **Node**: one `directory` or `file`, identified by its POSIX path relative to the root.
- **Source of truth**: server. Clients never enumerate FS or run `git status`.
- **Expand state / selection / scroll**: component-local, not persisted.

Empty directories are intentionally not represented — the source walker streams tracked files and derives directory nodes from those paths.

## Surface

```ts
// wire — POST /api/repo/tree
interface RepoTreeNode {
  readonly id: string           // relative POSIX path
  readonly path: string         // == id, named for readability
  readonly name: string         // final segment, used as display label
  readonly parentId: string | null
  readonly kind: 'directory' | 'file'
  readonly status: 'clean' | 'modified' | 'staged' | 'untracked' | 'ignored'
}

interface RepoTreeResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  readonly truncated: boolean   // true when depth / node cap cut the result
}
```

A flat `nodes[]`, not a nested tree — the view derives the parent/child index with `useMemo`. The list of stable entry points is exactly:

| Entry                                        | Purpose                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `POST /api/repo/tree`                        | wire endpoint (body schema: `REPO_PROCEDURE_SCHEMAS.tree`)         |
| `getRepositoryTree(cwd, worktreePath, opts?)` | server read; rejects paths outside the worktree list               |
| `src/server/modules/repo-tree-source.ts`     | FS walker / SSH executor — returns nodes, no wire envelope         |
| `getRepositoryTree(cwd, worktreePath, opts?)` (web) | client boundary; thin `postServerJson` wrapper                |
| `useRepoTreeRefresh({ repoId, worktreePath })`| React Query wrapper; subscribes to existing `repo-query-invalidated` (`query: 'repo-snapshot'`) — no new event channel |
| `FiletreeView`                               | pure view; takes `{ tree, loading, error, onSelect?, onActivate? }` |

`onActivate` exists in v1 so future wiring (open in editor / Finder / terminal) does not need a breaking prop change. v1 ships with selection only.

## Wiring

- **Workspace pane**: new static view `'files'`, `scope = 'worktree'` (same gating as `changes`). Tab provider icon `FolderTree`, label key `tab.files`. Reuses tab ordering, dnd-kit reorder, keyboard nav, and tooltip layer — nothing custom.
- **Session state**: extend the `preferredWorkspacePaneViewByBranchByRepo` picklist and `WorkspacePaneStaticTabOrderEntrySchema` so `'files'` round-trips through persisted session state. Existing values stay valid.
- **Refresh**: tied to `repo-query-invalidated` for `repo-snapshot`. No dedicated `'repo-tree'` query kind in v1.
- **Filtering**: server uses `git ls-files -co --exclude-standard -z` to respect `.gitignore`. The `status` field on each node comes from a single `git status --porcelain` pass keyed by path.

## Constraints

- Read-only. No drag/drop, multi-select, rename, delete, stage, copy, or in-tree search.
- No content preview, no virtualized rendering (revisit when measured visible nodes exceed ~1k).
- No persisted expand state across launches.
- No cross-worktree diff.
- Tree request state lives in React Query — do not extend `useReposStore` or `useSettingsStore`.
- The server read boundary intentionally has no `AbortSignal` option. A transport-level abort is not the same as an execution cancel: filetree reads soft-fail to `{ nodes: [], truncated: false }`, so wiring the request signal through would make a transient lifecycle event look like an empty worktree.