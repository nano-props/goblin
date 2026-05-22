# Project Notes

## Git operation boundaries

- Read-only git commands may run concurrently.
- Network git commands (`fetch`, `pull`, `push`) are cancellable and coalesced per repo where applicable.
- Avoid adding destructive git operations to the app. Prefer copying repository/worktree context so the user can run high-risk commands manually or hand them to an AI/terminal workflow.
- If a destructive operation is introduced later, design its stale-state, dirty-state, cancellation, and refresh-after-failure behavior explicitly before implementation.

## Dependency and import conventions

- When adding packages to `package.json`, use the latest available version and pin the exact version (no `^` or other range prefixes).
- Source imports should use the repo alias with explicit TypeScript extensions, e.g. `#/renderer/stores/i18n.ts` or `#/main/settings.ts`.
- Do not add re-export shim files. Import from the canonical source module directly instead.

## English UI copy conventions

- Use Title Case for native menu items.
- Use sentence case for buttons, actions, headings, and explanatory text.
- Use lowercase for status chips and badges, e.g. `open`, `dirty`, `no upstream`, `no worktree`, `modified`.
- Preserve official casing for proper nouns and acronyms, e.g. `GitHub`, `VS Code`, `PR`.
- Preserve raw git/status data as-is, e.g. branch names, paths, `M`, `A`, and `??`.
