import { execa } from 'execa'
import { expect, test } from 'vitest'

// Vitest stays on Node; exercise the actual Bun process/PTY/IPC boundary in
// a subprocess, including the same worker entry used by source development.
test('Bun worker preserves final output, geometry, Unicode and kill completion', async () => {
  const supervisorModule = new URL('./pty-supervisor-worker.ts', import.meta.url).href
  const entry = new URL('../main.ts', import.meta.url).pathname
  const { stdout } = await execa(
    'bun',
    [
      '--eval',
      `
    import { WorkerBackedPtySupervisor } from ${JSON.stringify(supervisorModule)}
    const supervisor = new WorkerBackedPtySupervisor({
      workerCommand: [process.execPath, ${JSON.stringify(entry)}, '--pty-worker'],
    })
    try {
      const result = await supervisor.spawn({
        command: '/bin/sh', args: [], cwd: process.cwd(), cols: 80, rows: 24,
      })
      if (!result.ok) throw new Error(result.message)
      let output = ''
      const claim = result.events.claim({ onData(event) { output += event.data }, onExit() {} })
      claim.activate()
      const resized = await supervisor.resize(result.handle, 101, 37)
      const written = await supervisor.write(result.handle, "stty size; printf '中文\\\\n'; exit\\n")
      await supervisor.waitForExit(result.handle)
      const live = await supervisor.spawn({
        command: '/bin/sh', args: [], cwd: process.cwd(), cols: 80, rows: 24,
      })
      if (!live.ok) throw new Error(live.message)
      await supervisor.killAndWait(live.handle)
      console.log(JSON.stringify({ output, resized, written, killed: true }))
    } finally { supervisor.shutdown() }
  `,
    ],
    { timeout: 8_000, env: { GOBLIN_NODE_LOG_LEVEL: 'silent' } },
  )
  const result = JSON.parse(stdout)
  expect(result).toMatchObject({ resized: true, written: { status: 'accepted' }, killed: true })
  expect(result.output).toContain('37 101\r\n')
  expect(result.output).toContain('中文\r\n')
})

test('Bun worker retires an exited shell while a background process still holds the PTY', async () => {
  const supervisorModule = new URL('./pty-supervisor-worker.ts', import.meta.url).href
  const entry = new URL('../main.ts', import.meta.url).pathname
  const { stdout } = await execa(
    'bun',
    [
      '--eval',
      `
    import { WorkerBackedPtySupervisor } from ${JSON.stringify(supervisorModule)}
    const supervisor = new WorkerBackedPtySupervisor({
      workerCommand: [process.execPath, ${JSON.stringify(entry)}, '--pty-worker'],
    })
    let output = ''
    let deadline
    try {
      const result = await supervisor.spawn({
        command: '/bin/sh',
        args: ['-c', 'trap "" HUP; sleep 30 & printf "BACKGROUND=%s\\\\n" "$!"; printf "final-output\\\\n"'],
        cwd: process.cwd(), cols: 80, rows: 24,
      })
      if (!result.ok) throw new Error(result.message)
      let exitCount = 0
      const claim = result.events.claim({
        onData(event) { output += event.data },
        onExit() { exitCount++ },
      })
      claim.activate()
      await Promise.race([
        supervisor.waitForExit(result.handle),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Shell exit waited for the background process')), 2000)
        }),
      ])
      const backgroundPid = Number(output.match(/BACKGROUND=(\\d+)/)?.[1])
      if (!backgroundPid) throw new Error('Missing background process PID')
      process.kill(backgroundPid, 0)
      console.log(JSON.stringify({ output, exitCount, backgroundAliveAtExit: true }))
    } finally {
      clearTimeout(deadline)
      const backgroundPid = Number(output.match(/BACKGROUND=(\\d+)/)?.[1])
      if (backgroundPid) {
        try { process.kill(backgroundPid, 'SIGKILL') }
        catch (error) { if (error.code !== 'ESRCH') throw error }
      }
      supervisor.shutdown()
    }
  `,
    ],
    { timeout: 8_000, env: { GOBLIN_NODE_LOG_LEVEL: 'silent' } },
  )
  const result = JSON.parse(stdout)
  expect(result).toMatchObject({ exitCount: 1, backgroundAliveAtExit: true })
  expect(result.output).toContain('final-output\r\n')
})
