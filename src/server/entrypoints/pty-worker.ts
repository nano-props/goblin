import { bootstrapPtyWorker } from '#/server/terminal/pty-worker-bootstrap.ts'

if (import.meta.main) bootstrapPtyWorker()
