// Server-side logger. Kept as a thin re-export of the shared Node logger
// in `src/node/logger.ts` so every existing `import { serverLogger } from
// '#/server/logger.ts'` call site continues to work without churn. New
// Node-side loggers (main, preload, system) live next to this one in
// `src/node/logger.ts`; if you find yourself reaching for `console.*` in
// a `.ts` file under `src/`, that file should import from
// `src/node/logger.ts` (or this one) instead.

export { serverNodeLog as serverLogger } from '#/node/logger.ts'
