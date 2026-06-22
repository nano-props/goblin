# Project Notes

## TypeScript constraints

The project runs in Node.js strip-only mode (no `tsc` emit). Do not use these unsupported TypeScript features:

- Enum declarations
- Namespaces with runtime code
- Parameter properties (`constructor(private readonly x: T)`)
- Import aliases (`import A = B`, `import A = require('B')`)

## Core conventions

- Pin new package versions exactly in `package.json`; no range prefixes.
- Use repo-alias imports with explicit `.ts`/`.tsx` extensions. Import canonical modules directly; do not add re-export shims.
- Verify with `bun run typecheck` and `bun run test` (`bun run test:watch` for watch mode).
- Keep examples, tests, docs, and snapshots privacy-safe: use generic placeholders, not real users, paths, emails, tokens, or internal identifiers.
- Keep i18n keys traceable: do not put conditionals, template strings, concatenation, or fallback expressions directly inside `t(...)`. Choose a named `*Key` variable first, or use a typed/static key map for dynamic states, then call `t(key)`.

## Git and safety

- Read-only git commands may run concurrently.
- Keep network git commands (`fetch`, `pull`, `push`) cancellable and coalesced per repo.
- Avoid destructive git features in the app. If one is introduced, design safety, cancellation, and recovery explicitly first.

## App-level design docs

- Application-level design guidance lives under `docs/`:
  - `docs/README.md` for the overview
  - `docs/ui-conventions.md` for UI conventions
  - `docs/arch.md` for architecture
  - `docs/layering.md` for feature layering rules
  - `docs/state-sync.md` for state ownership and sync guidance
  - `docs/renderer-model.md` for renderer model guidance
  - `docs/realtime.md` for realtime guidance
  - `docs/terminal.md` for terminal system design
  - `docs/terminal-roadmap.md` for terminal refactor roadmap
  - `docs/terminal-target-model.md` for terminal lifecycle and ownership target model
- Keep the architecture guard green with `bun run check:architecture`. The enforced boundaries are:
  - `src/main/**` must not import `src/web/**` or `src/server/**`.
  - `src/web/**` must not import `src/main/**`.
  - `src/server/**` and `src/shared/**` must not import `electron`.
