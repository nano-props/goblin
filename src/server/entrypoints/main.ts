import { bootstrapServer } from '#/server/bootstrap.ts'

if (import.meta.main) bootstrapServer({ terminalWorkerDir: import.meta.dirname })
