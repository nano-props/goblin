# Project Notes

## TypeScript constraints

The project runs in Node.js strip-only mode (no `tsc` emit). Do not use these unsupported TypeScript features:

- Enum declarations
- Namespaces with runtime code
- Parameter properties (`constructor(private readonly x: T)`)
- Import aliases (`import A = B`, `import A = require('B')`)

## Core conventions

- Pin new package versions exactly in `package.json`; no range prefixes.
- Use repo-alias imports with explicit `.ts`/`.tsx` extensions. Import canonical modules directly; do not add re-export shims. The `src/web/stores/repos/test-utils.ts` re-export shim is a documented exception, kept until consumers migrate to `#/web/test-utils/bridge.ts` in a follow-up PR.
- Verify with `bun run typecheck` and `bun run test` (`bun run test:watch` for watch mode). Never use `bun test` directly — it bypasses the project's test config and guards.
- For detailed testing conventions (helpers, library policy, anti-patterns), follow `docs/testing.md`.
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
  - `docs/client-model.md` for client model guidance
  - `docs/realtime.md` for realtime guidance
  - `docs/terminal.md` for terminal system design
  - `docs/terminal-roadmap.md` for terminal refactor roadmap
  - `docs/terminal-target-model.md` for terminal lifecycle and ownership target model
- Keep the architecture guard green with `bun run check:architecture`. The enforced boundaries are:
  - `src/main/**` must not import `src/web/**` or `src/server/**`.
  - `src/web/**` must not import `src/main/**`.
  - `src/server/**` and `src/shared/**` must not import `electron`.
- Prefer server-first implementations for app behavior. Do not add IPC unless the behavior truly requires an Electron-only capability that cannot reasonably live behind the server/browser path; document the reason at the call site when IPC is necessary.

## HTTP request conventions

**POST is the default for all client→server traffic.** GET is the exception. (We don't follow REST conventions.) The embedded server runs on Node's `http.Server` via `@hono/node-server`, which inherits Node's default 16 KiB `maxHeaderSize`; past that, Node returns `431` _before_ Hono runs — URL payloads are a structural footgun.

Rules:

- **New client→server endpoints use `POST` + `postServerJson(path, body)`.** Reads are fine over POST.
- **GET is allowed only for:** WebSocket upgrade (`/ws/*`), external-infrastructure health checks (`/api/health*`), or a browser-addressable URL with a real consumer.
- **Never put arrays, unbounded long strings (> ~200 B), or `JSON.stringify`'d objects in the URL.** Bodies are bounded by `API_BODY_LIMIT_BYTES` (1 MiB) and the clipboard cap (12 MiB).
- **New endpoints follow the existing POST shape:** `postServerJson` client-side, `*_PROCEDURE_SCHEMAS` in `src/shared/procedure-schemas.ts`, `parseHttpBody` server-side, plus a row in `src/shared/embedded-server-ipc-routes.ts` if it needs an IPC entry.

Known GET endpoints that must migrate to POST: _none — every client→server endpoint that takes a payload now lives behind a POST body. The historical offenders (the three array-bearing endpoints plus the five `cwd`-bearing `/api/repo/{probe,snapshot,status,log,patch}` reads) all moved in this branch._

**Any PR that changes a GET's payload must migrate it to POST in the same PR.** Internal-only refactors (logic, comments) don't trigger migration. The only remaining GETs are the parameter-free ones the rule carves out: WebSocket upgrade (`/ws/*`), external health checks (`/api/health*`), public-infrastructure reads (`/api/i18n`, `/api/host`, `/api/settings`, `/api/settings/prefs`, `/api/settings/lan`, `/api/settings/external-apps`, `/api/remote/ssh-hosts`, `/api/auth/{whoami,access-token}`), and the SPA wildcard `app.get('*')`.

#### Migration checklist

- `src/web/*-client.ts` — `getServerJson(path, params, …)` → `postServerJson(path, body)`.
- `src/server/routes/*.ts` — `app.get` → `app.post`; `parseHttpQuery(REPO_QUERY_SCHEMAS.x)` → `parseHttpBody(REPO_PROCEDURE_SCHEMAS.x)`.
- `src/shared/procedure-schemas.ts` — add `*_PROCEDURE_SCHEMAS.x` mirroring the old query schema; remove the matching `REPO_QUERY_SCHEMAS.x` once callers have moved.
- `src/shared/embedded-server-ipc-routes.ts` — `method: 'GET'` → `method: 'POST'` if registered.
- Tests — route unit, IPC bridge, store/refresh, and test-utils fixtures that build query params for the endpoint.
- Validate with `bun run typecheck && bun run test && bun run check:architecture` before merge.

When reviewing PRs, reject changes that:

- add a query-string array parameter or lengthen an existing GET's parameter list;
- `JSON.stringify` an object into a query parameter;
- touch a GET's payload without migrating it to POST;
- introduce a new GET where a POST would do, without one of the three concrete reasons.
