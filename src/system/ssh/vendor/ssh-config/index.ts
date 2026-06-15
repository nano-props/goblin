// Vendored from ssh-config@5.1.0 (https://github.com/cyjake/ssh-config)
// MIT License — Copyright (c) 2017 Chen Yangjian
// See ./LICENSE for the full license text.
//
// Re-exports are narrowed to what `src/system/ssh/config.ts` actually
// consumes. The full upstream API surface remains available in
// `./ssh-config.ts` if a future caller needs it.

export { default } from './ssh-config.ts'
export { LineType } from './ssh-config.ts'
export type { Line, Section } from './ssh-config.ts'
