import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function installLinuxStatShim(root: string): NodeJS.ProcessEnv {
  const bin = path.join(root, 'linux-bin')
  const executable = path.join(bin, 'stat')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    executable,
    `#!${process.execPath}
const { statSync } = require('node:fs')

const args = process.argv.slice(2)
if (args.shift() !== '-c') process.exit(1)
const format = args.shift()
if (args[0] === '--') args.shift()
if (args.length !== 1) process.exit(1)

const value = statSync(args[0])
switch (format) {
  case '%Y':
    process.stdout.write(String(Math.floor(value.mtimeMs / 1_000)))
    break
  case '%a':
    process.stdout.write((value.mode & 0o7777).toString(8))
    break
  default:
    process.exit(1)
}
`,
  )
  chmodSync(executable, 0o755)
  return { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
}
